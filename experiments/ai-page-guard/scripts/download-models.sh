#!/usr/bin/env bash
# Downloads the Prompt Guard 22M ONNX model files into models/prompt-guard/
# Run this once before `npm run build`. The model files are not in git (69MB).

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
MODEL_DIR="$PROJECT_ROOT/models/prompt-guard"

mkdir -p "$MODEL_DIR"
cd "$MODEL_DIR"

BASE="https://huggingface.co/gravitee-io/Llama-Prompt-Guard-2-22M-onnx/resolve/main"

FILES=(
  "config.json"
  "tokenizer_config.json"
  "tokenizer.json"
  "special_tokens_map.json"
  "model.quant.onnx"
)

echo "Downloading Prompt Guard 22M model files to $MODEL_DIR..."
for f in "${FILES[@]}"; do
  if [ -f "$f" ]; then
    echo "  ✓ $f (already exists, skipping)"
  else
    echo "  → Downloading $f..."
    curl -sL "$BASE/$f" -o "$f"
  fi
done

echo "Done. Model size:"
du -sh "$MODEL_DIR"
