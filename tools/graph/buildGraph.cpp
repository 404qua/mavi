// This was originally drafted in python and then ported to C++ and optimized by claude

// buildGraph.cpp : stage 2 of the Mars pathfinder. Builds the tiled node/edge
// graph from marsTiles.bin (nodes come from the same rules as analyzeRegion.cpp).
//
// Build: g++ -O3 -march=native -fopenmp -std=c++17 buildGraph.cpp -o buildGraph
//
// Run  : ./buildGraph marsTiles.bin --out marsGraph            (full planet)
//        ./buildGraph marsTiles.bin --bench 200                (time/size probe)
//        ./buildGraph marsTiles.bin --window tx ty w h --out g (partial build)
//   options: --region 256 --portal-spacing 8 --long-run 6 --min-comp 1000
//            --lambda 50        weight metres per cost point at a full N/S step
//            --no-prune         keep every node pair (testing only)
//            --threads N  --seed S  --wrap-mul X  --force
//
// Graph:
// Cost model
//   Every move from cell A to adjacent cell B costs
//       distance(A,B) + lambda * distance(A,B) / d0 * blendedCost(A,B)
//   where d0 is the nominal N/S cell size (about 200 m), and
//       blendedCost(A,B) = 0.75 * ((costA + costB) / 2) + 0.25 * costB.
//
//   Cost is scaled by physical step length, so short E/W steps near the poles
//   incur proportionally smaller terrain penalties than full N/S steps.
//   Integer weights are stored in centimetres.
//
//   The destination bias makes edge weights directional when endpoint costs
//   differ. The builder therefore stores A->B and B->A separately. A runtime
//   portal crossing must use the same blended formula with source/destination
//   side costs; NodeRec.cc stores side 0 in the low nibble and side 1 high.
//
// Search states are HALF-NODES = (node, side) = "standing on that cell".
// Edges are directed and join half-nodes within the same region/component.
// Edge records are 8 bytes: word 0 = target node index (bits 0-29) | target
// side << 30 (bit 31 reserved, always 0), word 1 = weight in cm.

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <functional>
#include <iomanip>
#include <iostream>
#include <limits>
#include <numeric>
#include <random>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#ifdef _OPENMP
#include <omp.h>
#endif

namespace {

constexpr int NB = 1, EB = 2, SB = 4, WB = 8;
constexpr double MARS_RADIUS = 3396190.0;
constexpr double PIX_DEG = 0.003374120830641;
constexpr uint32_t BLOB_MAGIC = 0x3254474Du;  // "MGT2"

// The .idx header still carries the slots that used to hold the (now removed)
// alternative-route parameters, so indexes written by older alt=0 runs keep
// matching and can be resumed. These are the values those runs wrote with
// default settings; they have no other meaning.
constexpr int32_t LEGACY_ALT_COUNT = 0;
constexpr int32_t LEGACY_WP_STRIDE = 32;
constexpr int32_t LEGACY_ALT_TRIES = 8;
constexpr double LEGACY_ALT_MIN = 0.04;
constexpr double LEGACY_ALT_MAX = 0.25;
constexpr double LEGACY_ALT_OVERLAP = 0.50;

int T = 512, tilesX = 0, tilesY = 0, W = 0, ROWS = 0, firstRow = 4446;
int R = 256, K = 2, regionsX = 0, regionsY = 0;
int longRun = 6, portalSpacing = 8, minComp = 1000;
double lambdaM = 50.0;
bool pruneOn = true;
double wrapMulOpt = -1.0, wrapMulUsed = 1.0;

int64_t lamCm = 5000, nsCm = 20000;
constexpr int reverseBiasPct = 25;
std::vector<uint32_t> ewCm;
const uint8_t* gridBase = nullptr;

[[noreturn]] void fail(const std::string& m) {
    throw std::runtime_error(m);
}

inline uint8_t px(int x, int r) {
    if (x < 0 || x >= W || r < 0 || r >= ROWS) return 0x0F;
    const size_t tile = static_cast<size_t>(r / T) * tilesX + (x / T);
    return gridBase[tile * T * T +
                    static_cast<size_t>(r % T) * T + (x % T)];
}

inline int costOf(uint8_t b) { return b & 15; }
inline int maskOf(uint8_t b) { return b >> 4; }

inline uint64_t makeKey(uint32_t x, uint32_t r, uint32_t dir) {
    return (static_cast<uint64_t>(r) << 24) |
           (static_cast<uint64_t>(x) << 2) | dir;
}

inline uint32_t keyDir(uint64_t k) {
    return static_cast<uint32_t>(k & 3);
}

inline uint32_t keyX(uint64_t k) {
    return static_cast<uint32_t>((k >> 2) & 0x3FFFFF);
}

inline uint32_t keyRow(uint64_t k) {
    return static_cast<uint32_t>(k >> 24);
}

// Offsets (0..len-1) of the portal cells inside one entrance
inline int portalOffsets(int len, int* out, int cap) {
    if (len <= longRun) {
        out[0] = (len - 1) / 2;
        return 1;
    }

    int n = 2;
    if (portalSpacing > 0) {
        n = (len - 1 + portalSpacing - 1) / portalSpacing + 1;
        if (n < 2) n = 2;
    }

    if (n > cap) n = cap;

    for (int j = 0; j < n; ++j) {
        out[j] = static_cast<int>(
            (static_cast<int64_t>(j) * (len - 1) + (n - 1) / 2) /
            (n - 1));
    }

    return n;
}


struct Stats {
    uint64_t tiles = 0, emptyTiles = 0, regions = 0, comps = 0;
    uint64_t nodeRecs = 0, portalRecs = 0, interiorRecs = 0;
    uint64_t pairsTotal = 0, pairsKept = 0;
    uint64_t edgesDirected = 0, visits = 0, blobBytes = 0;
    uint64_t maxCompNodes = 0, maxTileEdges = 0, overflow = 0;

    void merge(const Stats& o) {
        tiles += o.tiles;
        emptyTiles += o.emptyTiles;
        regions += o.regions;
        comps += o.comps;
        nodeRecs += o.nodeRecs;
        portalRecs += o.portalRecs;
        interiorRecs += o.interiorRecs;
        pairsTotal += o.pairsTotal;
        pairsKept += o.pairsKept;
        edgesDirected += o.edgesDirected;
        visits += o.visits;
        blobBytes += o.blobBytes;
        maxCompNodes = std::max(maxCompNodes, o.maxCompNodes);
        maxTileEdges = std::max(maxTileEdges, o.maxTileEdges);
        overflow += o.overflow;
    }
};

struct Region {
    bool exists = false;
    int rx = 0, ry = 0, x0 = 0, x1 = 0, r0 = 0, r1 = 0, w = 0, h = 0;
    int compCount = 0;
    std::vector<uint8_t> buf;
    std::vector<int32_t> lab;
    std::vector<uint32_t> size;
    std::vector<uint8_t> regExit;
};

void loadRegion(Region& g, int rx, int ry) {
    g.rx = rx;
    g.ry = ry;
    g.exists = rx < regionsX && ry < regionsY;
    if (!g.exists) {
        g.compCount = 0;
        return;
    }

    g.x0 = rx * R;
    g.x1 = std::min(W, g.x0 + R);
    g.r0 = ry * R;
    g.r1 = std::min(ROWS, g.r0 + R);
    g.w = g.x1 - g.x0;
    g.h = g.r1 - g.r0;

    const int tx = g.x0 / T, ty = g.r0 / T;
    for (int i = 0; i < g.h; ++i) {
        const int r = g.r0 + i;
        const uint8_t* src = gridBase +
            (static_cast<size_t>(ty) * tilesX + tx) * T * T +
            static_cast<size_t>(r % T) * T + (g.x0 % T);
        std::memcpy(&g.buf[static_cast<size_t>(i) * g.w], src, g.w);
    }
}

void labelRegion(Region& g, std::vector<int>& stack) {
    const int n = g.w * g.h;
    std::fill(g.lab.begin(), g.lab.begin() + n, -1);
    g.size.clear();

    int comp = 0;
    for (int i = 0; i < n; ++i) {
        if (costOf(g.buf[i]) == 15 || g.lab[i] >= 0) continue;

        uint32_t count = 0;
        stack.clear();
        stack.push_back(i);
        g.lab[i] = comp;

        while (!stack.empty()) {
            const int c = stack.back();
            stack.pop_back();
            ++count;

            const int y = c / g.w, x = c % g.w, m = maskOf(g.buf[c]);
            auto visit = [&](int nb, int d, int rd) {
                if ((m & d) && g.lab[nb] < 0 && costOf(g.buf[nb]) < 15 &&
                    (maskOf(g.buf[nb]) & rd)) {
                    g.lab[nb] = comp;
                    stack.push_back(nb);
                }
            };

            if (y > 0) visit(c - g.w, NB, SB);
            if (y < g.h - 1) visit(c + g.w, SB, NB);
            if (x < g.w - 1) visit(c + 1, EB, WB);
            if (x > 0) visit(c - 1, WB, EB);
        }

        g.size.push_back(count);
        ++comp;
    }

    g.compCount = comp;
    g.regExit.assign(comp, 0);
}

void markRegExit(Region& g) {
    auto note = [&](int ci) { g.regExit[g.lab[ci]] = 1; };

    for (int x = 0; x < g.w; ++x) {
        uint8_t b = g.buf[x];
        if (costOf(b) < 15 && (maskOf(b) & NB) && g.ry > 0) note(x);

        const int bi = (g.h - 1) * g.w + x;
        b = g.buf[bi];
        if (costOf(b) < 15 && (maskOf(b) & SB) &&
            g.ry + 1 < regionsY) note(bi);
    }

    for (int y = 0; y < g.h; ++y) {
        int ci = y * g.w;
        uint8_t b = g.buf[ci];
        if (costOf(b) < 15 && (maskOf(b) & WB)) note(ci);

        ci = y * g.w + g.w - 1;
        b = g.buf[ci];
        if (costOf(b) < 15 && (maskOf(b) & EB)) note(ci);
    }
}

// node discovery
struct RNode {
    uint64_t key;
    int cell;      // region-local cell index
    uint8_t side;  // 0 = canonical cell, 1 = cell across the border
    int comp;
    int tileIdx = -1;
};

void discoverNodes(const Region& g, std::vector<RNode>& out) {
    const int n = g.w * g.h;

    for (int side = 0; side < 4; ++side) {
        if (side == 0 && g.ry == 0) continue;
        if (side == 2 && g.ry + 1 >= regionsY) continue;

        const bool vertical = (side == 1 || side == 3);
        const int len = vertical ? g.h : g.w;
        const int bitA = side == 0 ? NB : side == 1 ? EB :
                         side == 2 ? SB : WB;
        const int bitB = side == 0 ? SB : side == 1 ? WB :
                         side == 2 ? NB : EB;
        const int along = vertical ? SB : EB;

        auto cellIdx = [&](int i) {
            switch (side) {
                case 0: return i;
                case 1: return i * g.w + g.w - 1;
                case 2: return (g.h - 1) * g.w + i;
                default: return i * g.w;
            }
        };

        auto addPortal = [&](int i) {
            const int cell = cellIdx(i);
            uint32_t cx, cr, dir, s;
            switch (side) {
                case 0:
                    cx = g.x0 + i;
                    cr = g.r0 - 1;
                    dir = 2;
                    s = 1;
                    break;
                case 1:
                    cx = g.x1 - 1;
                    cr = g.r0 + i;
                    dir = 1;
                    s = 0;
                    break;
                case 2:
                    cx = g.x0 + i;
                    cr = g.r1 - 1;
                    dir = 2;
                    s = 0;
                    break;
                default:
                    cx = (g.x0 - 1 + W) % W;
                    cr = g.r0 + i;
                    dir = 1;
                    s = 1;
                    break;
            }
            out.push_back({makeKey(cx, cr, dir), cell,
                           static_cast<uint8_t>(s), g.lab[cell], -1});
        };

        int runStart = -1, runLen = 0;
        uint8_t prevA = 0, prevB = 0;

        auto flush = [&]() {
            if (runLen <= 0) return;
            int offs[4096];
            const int np = portalOffsets(runLen, offs, 4096);
            for (int j = 0; j < np; ++j) addPortal(runStart + offs[j]);
        };

        for (int i = 0; i < len; ++i) {
            const uint8_t a = g.buf[cellIdx(i)];
            uint8_t b;

            switch (side) {
                case 0: b = px(g.x0 + i, g.r0 - 1); break;
                case 1: b = px(g.x1 % W, g.r0 + i); break;
                case 2: b = px(g.x0 + i, g.r1); break;
                default: b = px((g.x0 - 1 + W) % W, g.r0 + i); break;
            }

            const bool legal = costOf(a) < 15 && (maskOf(a) & bitA) &&
                               costOf(b) < 15 && (maskOf(b) & bitB);
            const bool cont = legal && runLen > 0 &&
                              (maskOf(prevA) & along) &&
                              (maskOf(prevB) & along);

            if (legal && cont) {
                ++runLen;
            } else {
                flush();
                if (legal) {
                    runStart = i;
                    runLen = 1;
                } else {
                    runLen = 0;
                }
            }

            prevA = a;
            prevB = b;
        }

        flush();
    }

    // interior nodes
    std::vector<int64_t> sx(g.compCount, 0), sy(g.compCount, 0);
    for (int i = 0; i < n; ++i) {
        const int l = g.lab[i];
        if (l >= 0) {
            sx[l] += i % g.w;
            sy[l] += i / g.w;
        }
    }

    auto pick = [&](const std::vector<uint8_t>& wanted) {
        std::vector<int> any(g.compCount, -1), open(g.compCount, -1);
        std::vector<int64_t> bd(
            g.compCount, std::numeric_limits<int64_t>::max());
        std::vector<int64_t> bd15(
            g.compCount, std::numeric_limits<int64_t>::max());
        std::vector<int> bc(g.compCount, 99), bc15(g.compCount, 99);

        for (int i = 0; i < n; ++i) {
            const int l = g.lab[i];
            if (l < 0 || !wanted[l]) continue;

            const int64_t dx =
                static_cast<int64_t>(i % g.w) * g.size[l] - sx[l];
            const int64_t dy =
                static_cast<int64_t>(i / g.w) * g.size[l] - sy[l];
            const int64_t d2 = dx * dx + dy * dy;
            const int c = costOf(g.buf[i]);

            if (d2 < bd[l] || (d2 == bd[l] && c < bc[l])) {
                bd[l] = d2;
                bc[l] = c;
                any[l] = i;
            }

            if (maskOf(g.buf[i]) == 15 &&
                (d2 < bd15[l] || (d2 == bd15[l] && c < bc15[l]))) {
                bd15[l] = d2;
                bc15[l] = c;
                open[l] = i;
            }
        }

        for (int l = 0; l < g.compCount; ++l)
            if (open[l] >= 0) any[l] = open[l];

        return any;
    };

    auto addInterior = [&](int cell) {
        const uint32_t cx = g.x0 + cell % g.w;
        const uint32_t cr = g.r0 + cell / g.w;
        out.push_back({makeKey(cx, cr, 0), cell, 0, g.lab[cell], -1});
    };

    std::vector<uint8_t> wanted(g.compCount, 0);
    int interiorWanted = 0;

    for (int l = 0; l < g.compCount; ++l) {
        if (g.regExit[l] &&
            g.size[l] > static_cast<uint32_t>(minComp)) {
            wanted[l] = 1;
            ++interiorWanted;
        }
    }

    if (interiorWanted > 0) {
        const std::vector<int> cells = pick(wanted);
        for (int l = 0; l < g.compCount; ++l)
            if (wanted[l]) addInterior(cells[l]);
    } else {
        int best = -1;
        for (int l = 0; l < g.compCount; ++l) {
            if (g.regExit[l] && g.size[l] >= 2 &&
                (best < 0 || g.size[l] > g.size[best])) {
                best = l;
            }
        }

        if (best >= 0) {
            wanted[best] = 1;
            const std::vector<int> cells = pick(wanted);
            addInterior(cells[best]);
        }
    }
}

// per-thread scratch
struct Scratch {
    std::vector<int> stack;
    std::vector<uint32_t> dist, ep;
    uint32_t epoch = 0;
    std::vector<uint8_t> tgt;
    std::vector<int32_t> cellSrc;
    std::vector<uint64_t> heap;
    std::vector<uint32_t> Wk;
    std::vector<Region> regions;

    Scratch() {
        const size_t n = static_cast<size_t>(R) * R;
        dist.assign(n, 0);
        ep.assign(n, 0);
        tgt.assign(n, 0);
        cellSrc.assign(n, -1);
        heap.reserve(n * 2);
        regions.resize(static_cast<size_t>(K) * K);
        for (auto& r : regions) {
            r.buf.resize(n);
            r.lab.resize(n);
        }
    }
};

struct EdgeTmp {
    uint32_t from;
    uint8_t fromSide;
    uint32_t to;
    uint8_t toSide;
    uint32_t w;
};

struct TNode {
    uint64_t key;
    uint8_t cc;
};

// Physical step plus terrain penalty. 75% uses the symmetric endpoint average;
// 25% uses the destination cost to retain a mild reverse-traversal penalty.
inline int64_t stepWeight(int64_t dcm, int fromCost, int toCost) {
    const int blendedNumerator =
        (100 - reverseBiasPct) * (fromCost + toCost) +
        2 * reverseBiasPct * toCost;
    const int64_t numerator = lamCm * dcm * blendedNumerator;
    const int64_t denominator = nsCm * 200;
    const int64_t penalty = (numerator + denominator / 2) / denominator;
    return dcm + penalty;
}

// Dijkstra over one region from a cell. The precomputed step tables are
// indexed by (fromCost * 16 + toCost), with an additional y * 256 offset for
// E/W steps. Stops once all `targets` target cells have been settled.
uint64_t dijkstra(const Region& g, Scratch& sc, int src, int targets,
                  const std::vector<uint32_t>& /*ewY*/,
                  const uint32_t* tblNS, const uint32_t* tblEW) {
    const int w = g.w;
    const uint8_t* buf = g.buf.data();

    ++sc.epoch;
    if (sc.epoch == 0xFFFFFFFFu) {
        std::fill(sc.ep.begin(), sc.ep.end(), 0);
        sc.epoch = 1;
    }

    auto& heap = sc.heap;
    heap.clear();

    auto push = [&](uint32_t d, int c) {
        heap.push_back(
            (static_cast<uint64_t>(d) << 20) | static_cast<uint64_t>(c));
        std::push_heap(heap.begin(), heap.end(), std::greater<uint64_t>());
    };

    sc.dist[src] = 0;
    sc.ep[src] = sc.epoch;
    push(0, src);

    uint64_t visits = 0;
    int rem = targets;

    while (!heap.empty()) {
        std::pop_heap(heap.begin(), heap.end(), std::greater<uint64_t>());
        const uint64_t key = heap.back();
        heap.pop_back();

        const int u = static_cast<int>(key & 0xFFFFF);
        const uint32_t d = static_cast<uint32_t>(key >> 20);
        if (d != sc.dist[u]) continue;

        ++visits;
        if (sc.tgt[u] && --rem == 0) break;

        const int y = u / w, x = u - y * w;
        const int m = buf[u] >> 4;
        const int cu = buf[u] & 15;

        auto relax = [&](int v, uint32_t stepW) {
            const uint64_t nd = static_cast<uint64_t>(d) + stepW;
            if (nd > 0xFFFFFFF0ull) return;

            if (sc.ep[v] != sc.epoch || nd < sc.dist[v]) {
                sc.ep[v] = sc.epoch;
                sc.dist[v] = static_cast<uint32_t>(nd);
                push(static_cast<uint32_t>(nd), v);
            }
        };

        if (y > 0 && (m & NB)) {
            const uint8_t b = buf[u - w];
            if ((b & 15) < 15 && ((b >> 4) & SB))
                relax(u - w, tblNS[(cu << 4) | (b & 15)]);
        }

        if (y < g.h - 1 && (m & SB)) {
            const uint8_t b = buf[u + w];
            if ((b & 15) < 15 && ((b >> 4) & NB))
                relax(u + w, tblNS[(cu << 4) | (b & 15)]);
        }

        if (x < w - 1 && (m & EB)) {
            const uint8_t b = buf[u + 1];
            if ((b & 15) < 15 && ((b >> 4) & WB))
                relax(u + 1, tblEW[y * 256 + (cu << 4) + (b & 15)]);
        }

        if (x > 0 && (m & WB)) {
            const uint8_t b = buf[u - 1];
            if ((b & 15) < 15 && ((b >> 4) & EB))
                relax(u - 1, tblEW[y * 256 + (cu << 4) + (b & 15)]);
        }
    }

    return visits;
}

struct TileBuild {
    std::vector<TNode> nodes;
    std::vector<EdgeTmp> edges;
    std::vector<std::vector<RNode>> rnodes;
};

void solveComponent(const Region& g, Scratch& sc, TileBuild& tb,
                    const std::vector<RNode>& rn, const std::vector<int>& nl,
                    Stats& st) {
    const int n = static_cast<int>(nl.size());

    // Sources = distinct cells of the nodes. Targets use the same set.
    // Column t of the weight matrix is node t.
    std::vector<int> srcCells, cellOf(n), srcOf(n);

    auto srcIndex = [&](int cell) {
        if (sc.cellSrc[cell] < 0) {
            sc.cellSrc[cell] = static_cast<int>(srcCells.size());
            srcCells.push_back(cell);
        }
        return sc.cellSrc[cell];
    };

    for (int j = 0; j < n; ++j) {
        cellOf[j] = rn[nl[j]].cell;
        srcOf[j] = srcIndex(cellOf[j]);
    }

    const int Ks = static_cast<int>(srcCells.size());

    int targets = 0;
    for (int c : srcCells) {
        sc.tgt[c] = 1;
        ++targets;
    }

    std::vector<uint32_t> ewY(g.h);
    std::vector<uint32_t> tblEW(static_cast<size_t>(g.h) * 256);
    std::vector<uint32_t> tblNS(256);

    for (int fromCost = 0; fromCost < 16; ++fromCost) {
        for (int toCost = 0; toCost < 16; ++toCost) {
            const int idx = (fromCost << 4) | toCost;
            tblNS[idx] =
                static_cast<uint32_t>(stepWeight(nsCm, fromCost, toCost));
        }
    }

    for (int y = 0; y < g.h; ++y) {
        ewY[y] = ewCm[g.r0 + y];

        for (int fromCost = 0; fromCost < 16; ++fromCost) {
            for (int toCost = 0; toCost < 16; ++toCost) {
                const int idx = (fromCost << 4) | toCost;
                tblEW[static_cast<size_t>(y) * 256 + idx] =
                    static_cast<uint32_t>(
                        stepWeight(ewY[y], fromCost, toCost));
            }
        }
    }

    sc.Wk.assign(static_cast<size_t>(Ks) * n, 0);

    for (int k = 0; k < Ks; ++k) {
        st.visits += dijkstra(g, sc, srcCells[k], targets,
                              ewY, tblNS.data(), tblEW.data());

        for (int t = 0; t < n; ++t)
            sc.Wk[static_cast<size_t>(k) * n + t] = sc.dist[cellOf[t]];
    }

    for (int c : srcCells) {
        sc.tgt[c] = 0;
        sc.cellSrc[c] = -1;
    }

    st.comps += 1;
    st.maxCompNodes = std::max<uint64_t>(st.maxCompNodes, n);
    st.pairsTotal += static_cast<uint64_t>(n) * (n - 1);

    auto emit = [&](int a, int b, uint32_t w) {
        const RNode& A = rn[nl[a]];
        const RNode& B = rn[nl[b]];

        tb.edges.push_back({static_cast<uint32_t>(A.tileIdx), A.side,
                            static_cast<uint32_t>(B.tileIdx), B.side, w});
        st.edgesDirected += 1;
    };

    for (int a = 0; a < n; ++a) {
        const int ka = srcOf[a];
        const uint32_t* rowA = &sc.Wk[static_cast<size_t>(ka) * n];

        for (int b = 0; b < n; ++b) {
            if (b == a) continue;

            const uint64_t w = rowA[b];

            if (pruneOn) {
                bool dominated = false;

                for (int c = 0; c < n && !dominated; ++c) {
                    if (c == a || c == b) continue;
                    if (cellOf[c] == cellOf[a] ||
                        cellOf[c] == cellOf[b]) continue;

                    const uint64_t via =
                        static_cast<uint64_t>(rowA[c]) +
                        sc.Wk[static_cast<size_t>(srcOf[c]) * n + b];

                    if (via <= w) dominated = true;
                }

                if (dominated) continue;
            }

            st.pairsKept += 1;
            emit(a, b, static_cast<uint32_t>(w));
        }
    }
}

template <class V>
void putBytes(std::vector<uint8_t>& out, const V& v) {
    const uint8_t* p = reinterpret_cast<const uint8_t*>(&v);
    out.insert(out.end(), p, p + sizeof(V));
}

// Build one tile; returns the blob (empty vector = tile has no nodes).
std::vector<uint8_t> buildTile(int tx, int ty, Scratch& sc, Stats& st) {
    TileBuild tb;
    tb.rnodes.resize(static_cast<size_t>(K) * K);
    std::vector<uint64_t> keys;
    st.tiles += 1;

    for (int j = 0; j < K * K; ++j) {
        Region& g = sc.regions[j];
        loadRegion(g, tx * K + j % K, ty * K + j / K);
        if (!g.exists) continue;

        st.regions += 1;
        labelRegion(g, sc.stack);
        markRegExit(g);
        discoverNodes(g, tb.rnodes[j]);

        for (const RNode& n : tb.rnodes[j]) keys.push_back(n.key);
    }

    std::sort(keys.begin(), keys.end());
    keys.erase(std::unique(keys.begin(), keys.end()), keys.end());
    if (keys.empty()) {
        st.emptyTiles += 1;
        return {};
    }

    tb.nodes.resize(keys.size());

    for (size_t i = 0; i < keys.size(); ++i) {
        const uint64_t k = keys[i];
        const uint32_t x = keyX(k), r = keyRow(k), d = keyDir(k);
        int c0 = costOf(px(x, r)), c1 = 0;

        if (d == 1) c1 = costOf(px((x + 1) % W, r));
        else if (d == 2) c1 = costOf(px(x, r + 1));

        tb.nodes[i] = {k, static_cast<uint8_t>(c0 | (c1 << 4))};

        if (d == 0) st.interiorRecs += 1;
        else st.portalRecs += 1;
    }

    st.nodeRecs += keys.size();

    for (auto& v : tb.rnodes) {
        for (RNode& n : v) {
            n.tileIdx = static_cast<int>(
                std::lower_bound(keys.begin(), keys.end(), n.key) -
                keys.begin());
        }
    }

    for (int j = 0; j < K * K; ++j) {
        const Region& g = sc.regions[j];
        if (!g.exists) continue;

        const auto& rn = tb.rnodes[j];

        std::vector<int> order(rn.size());
        std::iota(order.begin(), order.end(), 0);

        std::stable_sort(order.begin(), order.end(), [&](int p, int q) {
            return rn[p].comp < rn[q].comp;
        });

        for (size_t s = 0; s < order.size();) {
            size_t e = s;
            while (e < order.size() &&
                   rn[order[e]].comp == rn[order[s]].comp) {
                ++e;
            }

            if (e - s >= 2) {
                std::vector<int> nl(order.begin() + s, order.begin() + e);
                solveComponent(g, sc, tb, rn, nl, st);
            }

            s = e;
        }
    }

    // serialise
    std::sort(tb.edges.begin(), tb.edges.end(),
              [](const EdgeTmp& p, const EdgeTmp& q) {
        if (p.from != q.from) return p.from < q.from;
        if (p.fromSide != q.fromSide) return p.fromSide < q.fromSide;
        if (p.to != q.to) return p.to < q.to;
        if (p.toSide != q.toSide) return p.toSide < q.toSide;
        return p.w < q.w;
    });

    st.maxTileEdges =
        std::max<uint64_t>(st.maxTileEdges, tb.edges.size());

    const uint32_t nN = static_cast<uint32_t>(tb.nodes.size());
    const uint32_t nE = static_cast<uint32_t>(tb.edges.size());

    std::vector<uint32_t> off(nN + 1, 0), mid(nN, 0);

    {
        size_t e = 0;

        for (uint32_t i = 0; i < nN; ++i) {
            off[i] = static_cast<uint32_t>(e);

            while (e < tb.edges.size() &&
                   tb.edges[e].from == i && tb.edges[e].fromSide == 0) {
                ++e;
            }

            mid[i] = static_cast<uint32_t>(e);

            while (e < tb.edges.size() && tb.edges[e].from == i) {
                ++e;
            }
        }

        off[nN] = static_cast<uint32_t>(e);
    }

    std::vector<uint8_t> blob;
    blob.reserve(16 + nN * 16ull + nE * 8ull);

    putBytes(blob, BLOB_MAGIC);
    putBytes(blob, nN);
    putBytes(blob, nE);
    putBytes(blob, static_cast<uint32_t>(0));

    for (uint32_t i = 0; i < nN; ++i) {
        const uint64_t k = tb.nodes[i].key;
        putBytes(blob, keyX(k));
        putBytes(blob, static_cast<uint16_t>(keyRow(k)));
        putBytes(blob, static_cast<uint8_t>(keyDir(k)));
        putBytes(blob, tb.nodes[i].cc);
        putBytes(blob, off[i]);
        putBytes(blob, mid[i]);
    }

    for (const EdgeTmp& e : tb.edges) {
        putBytes(blob, e.to | (static_cast<uint32_t>(e.toSide) << 30));
        putBytes(blob, e.w);
    }

    st.blobBytes += blob.size();
    return blob;
}

// index file
struct TileEntry {
    uint64_t offset = 0;
    uint32_t size = 0, nodes = 0;
};

struct Idx {
    int32_t ints[16];
    double dbls[6];
    uint64_t dataBytes = 0;
    std::vector<TileEntry> tiles;
};

// The header layout is unchanged from the versions that supported alternative
// routes; the alt slots are filled with the LEGACY_* constants (see top).
void fillHeader(Idx& ix, int rowsDone) {
    const int32_t v[16] = {
        3, T, tilesX, tilesY, W, ROWS, firstRow, R, portalSpacing,
        longRun, minComp, LEGACY_ALT_COUNT, LEGACY_WP_STRIDE,
        pruneOn ? 1 : 0, rowsDone, LEGACY_ALT_TRIES
    };
    std::memcpy(ix.ints, v, sizeof(v));

    const double d[6] = {
        lambdaM, LEGACY_ALT_MIN, LEGACY_ALT_MAX, LEGACY_ALT_OVERLAP,
        wrapMulUsed, static_cast<double>(nsCm)
    };
    std::memcpy(ix.dbls, d, sizeof(d));
}

void writeIdx(const std::string& path, const Idx& ix) {
    const std::string tmp = path + ".tmp";

    {
        std::ofstream f(tmp, std::ios::binary | std::ios::trunc);
        if (!f) fail("Cannot write " + tmp);

        f.write("MGRAPH01", 8);
        f.write(reinterpret_cast<const char*>(ix.ints), sizeof(ix.ints));
        f.write(reinterpret_cast<const char*>(ix.dbls), sizeof(ix.dbls));
        f.write(reinterpret_cast<const char*>(&ix.dataBytes), 8);
        f.write(reinterpret_cast<const char*>(ewCm.data()), ewCm.size() * 4);

        for (const TileEntry& t : ix.tiles) {
            f.write(reinterpret_cast<const char*>(&t.offset), 8);
            f.write(reinterpret_cast<const char*>(&t.size), 4);
            f.write(reinterpret_cast<const char*>(&t.nodes), 4);
        }

        if (!f) fail("Write failed: " + tmp);
    }

    std::filesystem::rename(tmp, path);
}

bool readIdx(const std::string& path, Idx& ix) {
    std::ifstream f(path, std::ios::binary);
    if (!f) return false;

    char magic[8];
    f.read(magic, 8);
    if (std::memcmp(magic, "MGRAPH01", 8) != 0) return false;

    f.read(reinterpret_cast<char*>(ix.ints), sizeof(ix.ints));
    f.read(reinterpret_cast<char*>(ix.dbls), sizeof(ix.dbls));
    f.read(reinterpret_cast<char*>(&ix.dataBytes), 8);
    f.seekg(static_cast<std::streamoff>(ROWS) * 4, std::ios::cur);

    ix.tiles.resize(static_cast<size_t>(tilesX) * tilesY);

    for (TileEntry& t : ix.tiles) {
        f.read(reinterpret_cast<char*>(&t.offset), 8);
        f.read(reinterpret_cast<char*>(&t.size), 4);
        f.read(reinterpret_cast<char*>(&t.nodes), 4);
    }

    return static_cast<bool>(f);
}

std::string human(double v) {
    std::ostringstream s;
    s << std::fixed << std::setprecision(2);

    if (v >= 1e12) s << v / 1e12 << " T";
    else if (v >= 1e9) s << v / 1e9 << " G";
    else if (v >= 1e6) s << v / 1e6 << " M";
    else if (v >= 1e3) s << v / 1e3 << " k";
    else s << v;

    return s.str();
}

void printStats(const Stats& s, double secs, size_t tilesDone, bool project) {
    std::cout << "\n  tiles built " << s.tiles << " (empty " << s.emptyTiles
              << "), regions " << s.regions << ", components solved " << s.comps << "\n"
              << "  node records " << human(s.nodeRecs) << " (portal " << human(s.portalRecs)
              << ", interior " << human(s.interiorRecs)
              << "; tile-border portals appear in both tiles)\n"
              << "  node pairs " << human(s.pairsTotal) << ", kept after pruning "
              << human(s.pairsKept) << " ("
              << (s.pairsTotal ? 100.0 * s.pairsKept / s.pairsTotal : 0.0) << "%)\n"
              << "  directed edge records " << human(s.edgesDirected)
              << ", weight overflows " << s.overflow << "\n"
              << "  largest component " << s.maxCompNodes << " nodes, largest tile "
              << human(s.maxTileEdges) << " edge records\n"
              << "  graph size " << human(s.blobBytes) << "B, Dijkstra visits "
              << human(s.visits) << ", " << secs << " s ("
              << human(secs > 0 ? s.visits / secs : 0) << " visits/s)\n";

    if (project && tilesDone > 0) {
        const double sc =
            static_cast<double>(static_cast<size_t>(tilesX) * tilesY) /
            tilesDone;

        std::cout << "\nProjected to all "
                  << static_cast<size_t>(tilesX) * tilesY
                  << " tiles (sample scaled linearly):\n"
                  << "  graph size  " << human(s.blobBytes * sc) << "B\n"
                  << "  edge records " << human(s.edgesDirected * sc) << "\n"
                  << "  build time  " << human(secs * sc) << " s  = "
                  << secs * sc / 3600.0 << " h on this machine\n";
    }
}

}

int main(int argc, char** argv) {
    try {
        std::string tilesPath, outPrefix;
        int wx = -1, wy = -1, ww = 0, wh = 0, benchN = 0, threads = 0;
        unsigned seed = 1;
        bool force = false;

        for (int i = 1; i < argc; ++i) {
            const std::string a = argv[i];

            auto next = [&]() -> const char* {
                if (i + 1 >= argc) fail("Missing value for " + a);
                return argv[++i];
            };

            if (a == "--window") {
                wx = std::atoi(next());
                wy = std::atoi(next());
                ww = std::atoi(next());
                wh = std::atoi(next());
            } else if (a == "--bench") benchN = std::atoi(next());
            else if (a == "--out") outPrefix = next();
            else if (a == "--region") R = std::atoi(next());
            else if (a == "--portal-spacing") portalSpacing = std::atoi(next());
            else if (a == "--long-run") longRun = std::atoi(next());
            else if (a == "--min-comp") minComp = std::atoi(next());
            else if (a == "--lambda") lambdaM = std::atof(next());
            else if (a == "--no-prune") pruneOn = false;
            else if (a == "--threads") threads = std::atoi(next());
            else if (a == "--seed") seed = static_cast<unsigned>(std::atoi(next()));
            else if (a == "--wrap-mul") wrapMulOpt = std::atof(next());
            else if (a == "--force") force = true;
            else if (!a.empty() && a[0] == '-') fail("Unknown option " + a);
            else tilesPath = a;
        }

        if (tilesPath.empty())
            fail("Usage: buildGraph marsTiles.bin [--out prefix | --bench N] [options]");

        {
            std::ifstream meta(tilesPath + ".meta.txt");
            if (!meta) fail("Cannot read " + tilesPath + ".meta.txt");

            std::string line;
            while (std::getline(meta, line)) {
                std::istringstream ls(line);
                std::string key;
                double v;

                if (ls >> key >> v) {
                    if (key == "tile") T = (int)v;
                    else if (key == "tiles_x") tilesX = (int)v;
                    else if (key == "tiles_y") tilesY = (int)v;
                    else if (key == "width") W = (int)v;
                    else if (key == "rows") ROWS = (int)v;
                    else if (key == "first_row") firstRow = (int)v;
                }
            }
        }

        if (T <= 0 || tilesX <= 0 || tilesY <= 0 || W <= 0 || ROWS <= 0)
            fail("Invalid tile metadata.");
        if (ROWS > 65535)
            fail("ROWS must fit in 16 bits for the node record.");
        if (R <= 0 || T % R != 0)
            fail("--region must divide the tile size.");
        if (R * R > (1 << 20))
            fail("Region too large for the 20-bit heap cell index.");
        if (portalSpacing < 0 || longRun <= 0 || minComp < 0 || lambdaM <= 0)
            fail("Invalid option value.");

        K = T / R;
        regionsX = (W + R - 1) / R;
        regionsY = (ROWS + R - 1) / R;

        // geometry
        const double pixRad = PIX_DEG * M_PI / 180.0;
        const double nsM = MARS_RADIUS * pixRad;
        nsCm = std::llround(nsM * 100.0);
        lamCm = std::llround(lambdaM * 100.0);

        ewCm.resize(ROWS);
        for (int r = 0; r < ROWS; ++r) {
            const double lat =
                90.0 - (r + firstRow + 0.5) * PIX_DEG;
            ewCm[r] = static_cast<uint32_t>(std::max<int64_t>(
                1, std::llround(nsM * 100.0 * std::cos(lat * M_PI / 180.0))));
        }

        {
            const double auto_ = 360.0 / PIX_DEG - (W - 1);
            wrapMulUsed = wrapMulOpt > 0 ? wrapMulOpt
                          : (auto_ >= 1.0 && auto_ <= 2.0 ? auto_ : 1.0);
        }

        // map the tile file
        const size_t expected =
            static_cast<size_t>(tilesX) * tilesY * T * T;
        const int fd = open(tilesPath.c_str(), O_RDONLY);
        if (fd < 0) fail("Cannot open " + tilesPath);

        struct stat sb{};
        if (fstat(fd, &sb) != 0 ||
            static_cast<uint64_t>(sb.st_size) != expected) {
            fail("Tile file size mismatch.");
        }

        void* map = mmap(nullptr, expected, PROT_READ, MAP_SHARED, fd, 0);
        if (map == MAP_FAILED) fail("mmap failed.");
        gridBase = static_cast<const uint8_t*>(map);

#ifdef _OPENMP
        if (threads > 0) omp_set_num_threads(threads);
        const int nThreads = omp_get_max_threads();
#else
        const int nThreads = 1;
#endif

        std::cout << "Threads: " << nThreads << "\nGrid " << W << " x " << ROWS
                  << ", tile " << T << " (" << tilesX << " x " << tilesY
                  << "), region " << R
                  << ", portal-spacing " << portalSpacing << ", lambda "
                  << lambdaM << " m/pt, reverse bias " << reverseBiasPct
                  << "%, prune " << (pruneOn ? "on" : "off")
                  << "\nns step " << nsCm << " cm, wrap multiplier "
                  << wrapMulUsed << "\n";

        std::vector<Scratch> scratch(nThreads);
        const auto t0 = std::chrono::steady_clock::now();

        auto elapsed = [&]() {
            return std::chrono::duration<double>(
                std::chrono::steady_clock::now() - t0).count();
        };

        if (benchN > 0) {
            std::vector<int> all(static_cast<size_t>(tilesX) * tilesY);
            std::iota(all.begin(), all.end(), 0);

            std::mt19937 rng(seed);
            std::shuffle(all.begin(), all.end(), rng);
            all.resize(std::min<size_t>(benchN, all.size()));

            std::vector<Stats> per(nThreads);

#pragma omp parallel for schedule(dynamic, 1)
            for (int i = 0; i < static_cast<int>(all.size()); ++i) {
#ifdef _OPENMP
                const int tid = omp_get_thread_num();
#else
                const int tid = 0;
#endif
                buildTile(all[i] % tilesX, all[i] / tilesX,
                          scratch[tid], per[tid]);
            }

            Stats tot;
            for (auto& s : per) tot.merge(s);

            printStats(tot, elapsed(), all.size(), true);
            munmap(map, expected);
            close(fd);
            return 0;
        }

        // build to disk
        if (outPrefix.empty()) fail("Give --out prefix (or --bench N).");

        const std::string binPath = outPrefix + ".bin";
        const std::string idxPath = outPrefix + ".idx";

        const bool windowMode =
            (wx != -1 || wy != -1 || ww != 0 || wh != 0);

        if (windowMode &&
            (wx < 0 || wy < 0 || ww <= 0 || wh <= 0 ||
             wx + ww > tilesX || wy + wh > tilesY)) {
            fail("--window is outside the tile grid.");
        }

        Idx ix;
        ix.tiles.assign(static_cast<size_t>(tilesX) * tilesY, TileEntry{});

        int startRow = 0;
        fillHeader(ix, 0);

        if (!windowMode && !force) {
            Idx old;

            if (readIdx(idxPath, old)) {
                Idx cur;
                fillHeader(cur, old.ints[14]);

                if (std::memcmp(cur.ints, old.ints, sizeof(cur.ints)) != 0 ||
                    std::memcmp(cur.dbls, old.dbls, sizeof(cur.dbls)) != 0) {
                    fail("Existing " + idxPath +
                         " was built with different parameters (use --force to restart).");
                }

                ix = old;
                startRow = old.ints[14];
                std::cout << "Resuming at tile row " << startRow
                          << " / " << tilesY << "\n";
            }
        }

        if (startRow == 0) {
            std::ofstream clear(binPath, std::ios::binary | std::ios::trunc);
            ix.dataBytes = 0;
        } else {
            std::filesystem::resize_file(binPath, ix.dataBytes);
        }

        FILE* out = std::fopen(binPath.c_str(), "r+b");
        if (!out) fail("Cannot open " + binPath);
        fseeko(out, static_cast<off_t>(ix.dataBytes), SEEK_SET);

        const int rowBegin = windowMode ? wy : startRow;
        const int rowEnd = windowMode ? wy + wh : tilesY;
        const int colBegin = windowMode ? wx : 0;
        const int colEnd = windowMode ? wx + ww : tilesX;

        std::vector<Stats> per(nThreads);
        Stats total;

        for (int ty = rowBegin; ty < rowEnd; ++ty) {
            std::vector<std::vector<uint8_t>> blobs(colEnd - colBegin);

#pragma omp parallel for schedule(dynamic, 1)
            for (int tx = colBegin; tx < colEnd; ++tx) {
#ifdef _OPENMP
                const int tid = omp_get_thread_num();
#else
                const int tid = 0;
#endif
                blobs[tx - colBegin] =
                    buildTile(tx, ty, scratch[tid], per[tid]);
            }

            for (int tx = colBegin; tx < colEnd; ++tx) {
                const auto& b = blobs[tx - colBegin];
                TileEntry& te =
                    ix.tiles[static_cast<size_t>(ty) * tilesX + tx];

                te.offset = ix.dataBytes;
                te.size = static_cast<uint32_t>(b.size());

                if (!b.empty()) {
                    uint32_t nN;
                    std::memcpy(&nN, &b[4], 4);
                    te.nodes = nN;

                    if (std::fwrite(b.data(), 1, b.size(), out) != b.size())
                        fail("Write failed.");

                    ix.dataBytes += b.size();
                }
            }

            std::fflush(out);
            fsync(fileno(out));

            fillHeader(ix, windowMode ? 0 : ty + 1);
            writeIdx(idxPath, ix);

            Stats cum;
            for (auto& s : per) cum.merge(s);

            std::cout << "\rtile row " << ty + 1 << "/" << tilesY << "  "
                      << human(cum.blobBytes) << "B  "
                      << human(cum.edgesDirected) << " edge records  "
                      << std::fixed << std::setprecision(0) << elapsed()
                      << " s   " << std::flush;
        }

        std::cout << "\n";
        std::fclose(out);

        for (auto& s : per) total.merge(s);
        printStats(total, elapsed(), 0, false);

        munmap(map, expected);
        close(fd);

        std::cout << "\nWrote " << binPath << " and " << idxPath << "\n";
        return 0;

    } catch (const std::exception& e) {
        std::cerr << "Error: " << e.what() << "\n";
        return 1;
    }
}