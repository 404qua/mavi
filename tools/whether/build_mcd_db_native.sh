#!/usr/bin/env bash
set -euo pipefail

ROOT="$HOME/MarsData/Data"
MCDSRC="$ROOT/MCD/mcd/MCD.F90"
SQLROOT="$ROOT/fortran-sqlite3"
SRC="$ROOT/build_mcd_db_native.f90"
OUT="$ROOT/build_mcd_db_native"

command -v gfortran >/dev/null
command -v nf-config >/dev/null
command -v git >/dev/null

if [[ ! -d "$SQLROOT" ]]; then
  git clone --depth 1 https://github.com/interkosmos/fortran-sqlite3 "$SQLROOT"
fi

make -C "$SQLROOT" FC=gfortran

SQLMOD=$(dirname "$(find "$SQLROOT" -type f -name sqlite3.mod -print -quit)")
SQLLIB=$(find "$SQLROOT" -type f -name libfortran-sqlite3.a -print -quit)

if [[ -z "$SQLMOD" || -z "$SQLLIB" ]]; then
  echo "Could not find the built fortran-sqlite3 module/library." >&2
  exit 1
fi

gfortran -O2 -ffree-line-length-none -fallow-argument-mismatch \
  $(nf-config --fflags) \
  -I"$(dirname "$MCDSRC")" \
  -I"$SQLMOD" \
  "$MCDSRC" \
  "$SRC" \
  "$SQLLIB" \
  $(nf-config --flibs) \
  -lsqlite3 \
  -o "$OUT"

printf 'Built: %s\n' "$OUT"
