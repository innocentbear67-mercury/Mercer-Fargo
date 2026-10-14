#!/usr/bin/env bash
# Marvell Predict installer (macOS / Linux): sets up Kronos locally and starts it.
#   curl -fsSL https://mercerfargo.trade/kronos/install.sh | bash
# Everything lands in ~/.marvell-kronos; delete that folder to uninstall.
set -euo pipefail

BASE="${MARVELL_BASE:-https://mercerfargo.trade}"
DIR="$HOME/.marvell-kronos"
KRONOS_SHA="67b630e67f6a18c9e9be918d9b4337c960db1e9a"   # pinned shiyu-coder/Kronos commit
say(){ printf '\n\033[1;33m==>\033[0m %s\n' "$1"; }

mkdir -p "$DIR"
cd "$DIR"

say "1/5 Python toolchain (uv)"
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi

say "2/5 Python 3.11 environment"
[ -x venv/bin/python ] || uv venv --python 3.11 venv

say "3/5 Kronos model code"
if [ ! -f Kronos/model/kronos.py ]; then
  rm -rf Kronos "Kronos-$KRONOS_SHA"
  curl -fsSL "https://codeload.github.com/shiyu-coder/Kronos/tar.gz/$KRONOS_SHA" | tar xz
  mv "Kronos-$KRONOS_SHA" Kronos
fi
curl -fsSL "$BASE/kronos/kronos_server.py" -o kronos_server.py

say "4/5 PyTorch and libraries (about 1 GB the first time)"
uv pip install --python venv/bin/python "torch>=2.0" numpy "pandas>=2.0" einops==0.8.1 \
  huggingface_hub==0.33.1 safetensors tqdm

cat > start.sh <<EOF
#!/usr/bin/env bash
cd "$DIR" || exit 1
# pick up server updates from the site; offline, keep the copy we have
curl -fsSL "$BASE/kronos/kronos_server.py" -o kronos_server.py.new 2>/dev/null && mv kronos_server.py.new kronos_server.py || rm -f kronos_server.py.new
exec ./venv/bin/python kronos_server.py
EOF
chmod +x start.sh
if [ "$(uname)" = "Darwin" ] && [ -d "$HOME/Desktop" ]; then
  printf '#!/usr/bin/env bash\nexec "%s/start.sh"\n' "$DIR" > "$HOME/Desktop/Marvell Predict.command"
  chmod +x "$HOME/Desktop/Marvell Predict.command"
fi

say "5/5 Downloading Kronos-base weights (~400 MB) and running a test forecast"
./venv/bin/python kronos_server.py --check

say "Done. Starting Marvell Predict — keep this window open, then go back to the site."
[ "$(uname)" = "Darwin" ] && echo "Next time, double-click 'Marvell Predict' on your Desktop."
[ "$(uname)" != "Darwin" ] && echo "Next time, run: $DIR/start.sh"
exec ./start.sh
