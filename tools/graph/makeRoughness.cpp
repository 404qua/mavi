// Thiuis script was originally written in python and later translated into C++ and optimized with the help of claude
// Takes 4x4 blocks and finnds roughness

#include "gdal_priv.h"
#include "cpl_conv.h"

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

static constexpr int blockSize = 4;

// Convert RMS roughness in meters into a 0-11 score.
static uint8_t roughnessScore(double rough)
{
    static constexpr double thresholds[] = {
        0.5,
        1.0,
        2.0,
        4.0,
        8.0,
        16.0,
        32.0,
        64.0,
        128.0,
        256.0,
        512.0
    };

    for (uint8_t i = 0; i < 11; ++i) {
        if (rough < thresholds[i])
            return i;
    }

    return 11;
}

// Calculate RMS residual from the best-fit plane.
//
// x/y are local pixel coordinates within the 4x4 block.
// z is elevation in meters.
//
// The caller normally provides a complete 4x4 block, but NoData
// holes can reduce the number of valid points.
static double blockRoughness(
    const std::vector<double>& xs,
    const std::vector<double>& ys,
    const std::vector<double>& zs,
    int n)
{
    if (n <= 0)
        return 0.0;

    double meanX = 0.0;
    double meanY = 0.0;
    double meanZ = 0.0;

    for (int i = 0; i < n; ++i) {
        meanX += xs[i];
        meanY += ys[i];
        meanZ += zs[i];
    }

    meanX /= n;
    meanY /= n;
    meanZ /= n;

    double sxx = 0.0;
    double syy = 0.0;
    double sxy = 0.0;
    double sxz = 0.0;
    double syz = 0.0;
    double szz = 0.0;

    for (int i = 0; i < n; ++i) {
        const double x = xs[i] - meanX;
        const double y = ys[i] - meanY;
        const double z = zs[i] - meanZ;

        sxx += x * x;
        syy += y * y;
        sxy += x * y;
        sxz += x * z;
        syz += y * z;
        szz += z * z;
    }

    // If there are too few points to reliably fit a plane,
    // fall back to ordinary RMS elevation variation.
    if (n < 6)
        return std::sqrt(std::max(0.0, szz / n));

    const double determinant = sxx * syy - sxy * sxy;

    if (std::abs(determinant) < 1e-12)
        return std::sqrt(std::max(0.0, szz / n));

    // Best-fit plane:
    //
    // z = a*x + b*y
    //
    // after centering x/y/z around their means.
    const double a =
    (sxz * syy - syz * sxy) / determinant;

    const double b =
    (syz * sxx - sxz * sxy) / determinant;

    // Sum of squared residuals after fitting the plane.
    double residualSS =
    szz - a * sxz - b * syz;

    if (residualSS < 0.0)
        residualSS = 0.0;

    // Three fitted parameters are involved in the full plane:
    // x coefficient, y coefficient, and intercept.
    const int degreesOfFreedom = n - 3;

    if (degreesOfFreedom <= 0)
        return std::sqrt(std::max(0.0, szz / n));

    return std::sqrt(residualSS / degreesOfFreedom);
}

int main(int argc, char** argv)
{
    if (argc != 3) {
        std::cerr
        << "Usage:\n"
        << "  " << argv[0]
        << " <input_dem.tif> <output.bin>\n";

        return 1;
    }

    const std::string inputPath = argv[1];
    const std::string outputPath = argv[2];

    GDALAllRegister();

    GDALDataset* dataset =
    static_cast<GDALDataset*>(
        GDALOpen(inputPath.c_str(), GA_ReadOnly));

    if (!dataset) {
        std::cerr
        << "ERROR: Could not open input DEM:\n"
        << inputPath << '\n';

        return 1;
    }

    GDALRasterBand* band = dataset->GetRasterBand(1);

    if (!band) {
        std::cerr << "ERROR: Could not access raster band 1.\n";
        GDALClose(dataset);
        return 1;
    }

    const int width = band->GetXSize();
    const int height = band->GetYSize();

    std::cout
    << "Input dimensions: "
    << width << " x " << height << '\n';

    if (width < blockSize || height < blockSize) {
        std::cerr
        << "ERROR: DEM is smaller than one "
        << blockSize << "x" << blockSize
        << " block.\n";

        GDALClose(dataset);
        return 1;
    }

    // Ceiling division.
    //
    // The final block in each direction is shifted backwards
    // when necessary so that it is always a complete 4x4 block.
    const int outputWidth =
    (width + blockSize - 1) / blockSize;

    const int outputHeight =
    (height + blockSize - 1) / blockSize;

    const uint64_t outputCells =
    static_cast<uint64_t>(outputWidth) *
    static_cast<uint64_t>(outputHeight);

    const uint64_t outputBytes =
    (outputCells + 1) / 2;

    std::cout
    << "Output dimensions: "
    << outputWidth << " x " << outputHeight << '\n';

    std::cout
    << "Output cells: "
    << outputCells << '\n';

    std::cout
    << "Output bytes: "
    << outputBytes << '\n';

    // Read the DEM's declared NoData value.
    int hasNoData = FALSE;
    const double declaredNoData =
    band->GetNoDataValue(&hasNoData);

    // Treat both Int16 extreme values as invalid as well.
    auto isNoData = [&](double value) -> bool {
        if (hasNoData &&
            std::abs(value - declaredNoData) < 0.5)
            return true;

        if (value == -32768.0 || value == 32767.0)
            return true;

        return false;
    };

    std::vector<uint8_t> output(
        static_cast<size_t>(outputBytes), 0);

    // Read four complete source rows at a time.
    //
    // The final output row is shifted backwards if necessary,
    // so sourceY is always <= height - 4.
    std::vector<float> strip(
        static_cast<size_t>(width) * blockSize);

    uint64_t nodataBlocks = 0;

    for (int outputY = 0;
         outputY < outputHeight;
    ++outputY)
         {
             const int normalSourceY =
             outputY * blockSize;

             // Shift the final block backwards so it remains 4 rows tall.
             const int sourceY =
             std::min(normalSourceY, height - blockSize);

             CPLErr err = band->RasterIO(
                 GF_Read,
                 0,
                 sourceY,
                 width,
                 blockSize,
                 strip.data(),
                                         width,
                                         blockSize,
                                         GDT_Float32,
                                         0,
                                         0,
                                         nullptr);

             if (err != CE_None) {
                 std::cerr
                 << "ERROR: Failed reading source rows at Y="
                 << sourceY << '\n';

                 GDALClose(dataset);
                 return 1;
             }

             for (int outputX = 0;
                  outputX < outputWidth;
             ++outputX)
                  {
                      const int normalSourceX =
                      outputX * blockSize;

                      // Shift the final block backwards so it remains 4 columns wide.
                      const int sourceX =
                      std::min(normalSourceX, width - blockSize);

                      std::vector<double> xs;
                      std::vector<double> ys;
                      std::vector<double> zs;

                      xs.reserve(blockSize * blockSize);
                      ys.reserve(blockSize * blockSize);
                      zs.reserve(blockSize * blockSize);

                      for (int localY = 0;
                           localY < blockSize;
                      ++localY)
                           {
                               for (int localX = 0;
                                    localX < blockSize;
                               ++localX)
                                    {
                                        const float value =
                                        strip[
                                            static_cast<size_t>(localY) *
                                            width +
                                            sourceX +
                                            localX
                                        ];

                                        if (isNoData(value))
                                            continue;

                                        xs.push_back(localX);
                                        ys.push_back(localY);
                                        zs.push_back(value);
                                    }
                           }

                           const int validCount =
                           static_cast<int>(zs.size());

                           uint8_t score = 11;

                           // Fewer than two valid points cannot provide
                           // meaningful roughness. Treat the entire block
                           // as NoData.
                           if (validCount < 2) {
                               score = 11;
                               ++nodataBlocks;
                           } else {
                               const double roughness =
                               blockRoughness(
                                   xs,
                                   ys,
                                   zs,
                                   validCount);

                               score = roughnessScore(roughness);
                           }

                           const uint64_t cellIndex =
                           static_cast<uint64_t>(outputY) *
                           outputWidth +
                           outputX;

                           const size_t byteIndex =
                           static_cast<size_t>(cellIndex / 2);

                           if ((cellIndex & 1ULL) == 0) {
                               // Even cell → low nibble.
                               output[byteIndex] =
                               (output[byteIndex] & 0xF0) |
                               (score & 0x0F);
                           } else {
                               // Odd cell → high nibble.
                               output[byteIndex] =
                               (output[byteIndex] & 0x0F) |
                               static_cast<uint8_t>(
                                   (score & 0x0F) << 4);
                           }
                  }

                  if ((outputY % 100) == 0 ||
                      outputY == outputHeight - 1)
                  {
                      const double progress =
                      100.0 *
                      static_cast<double>(outputY + 1) /
                      outputHeight;

                      std::cout
                      << "\rProcessing: "
                      << outputY + 1
                      << " / "
                      << outputHeight
                      << " rows ("
                      << progress
                      << "%)"
                      << std::flush;
                  }
         }

         std::cout << '\n';

         // Write packed binary output.
         std::ofstream outputFile(
             outputPath,
             std::ios::binary);

         if (!outputFile) {
             std::cerr
             << "ERROR: Could not create output file:\n"
             << outputPath << '\n';

             GDALClose(dataset);
             return 1;
         }

         outputFile.write(
             reinterpret_cast<const char*>(output.data()),
                          static_cast<std::streamsize>(output.size()));

         if (!outputFile) {
             std::cerr
             << "ERROR: Failed while writing output file.\n";

             GDALClose(dataset);
             return 1;
         }

         outputFile.close();

         // Write metadata beside the binary file.
         const std::string metadataPath =
         outputPath + ".meta.txt";

         std::ofstream metadata(metadataPath);

         if (!metadata) {
             std::cerr
             << "WARNING: Could not create metadata file:\n"
             << metadataPath << '\n';
         } else {
             metadata
             << "Marswalk Roughness Map\n"
             << "\n"
             << "Source dimensions: "
             << width << " x " << height << "\n"
             << "Block size: 4 x 4 source pixels\n"
             << "Output dimensions: "
             << outputWidth << " x "
             << outputHeight << "\n"
             << "Bits per cell: 4\n"
             << "Cells per byte: 2\n"
             << "First cell: low nibble\n"
             << "Second cell: high nibble\n"
             << "Values: 0-11\n"
             << "NoData score: 11\n"
             << "Metric: RMS residual from best-fit plane\n"
             << "Metric units: meters\n"
             << "Edge blocks: shifted backward to remain 4x4\n"
             << "Blocks with fewer than 2 valid pixels: NoData\n"
             << "NoData blocks: "
             << nodataBlocks << "\n";
         }

         GDALClose(dataset);

         std::cout
         << "Done.\n"
         << "Output: "
         << outputPath << '\n'
         << "Metadata: "
         << metadataPath << '\n'
         << "NoData blocks: "
         << nodataBlocks << '\n';

         return 0;
}
