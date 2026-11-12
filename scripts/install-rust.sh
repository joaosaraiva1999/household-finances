#!/bin/bash
# Install Rust toolchain using the direct rustup-init binary
LOG=/home/z/my-project/scripts/rustup.log
exec > "$LOG" 2>&1
set -x
/tmp/rustup-init2 -y --profile minimal --default-toolchain stable --no-modify-path
source "$HOME/.cargo/env"
rustc --version
cargo --version
echo "=== RUSTUP DONE ==="
