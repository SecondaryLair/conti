#!/bin/bash

echo "Current directory: $(pwd)"

latest_vsix=$(ls -t ./build/continue-lite-autocomplete-*.vsix 2>/dev/null | head -n1)

if [ -z "$latest_vsix" ]; then
    echo "No VSIX file found in build directory"
    exit 1
fi

mkdir -p "./e2e/vsix"

cp "$latest_vsix" "./e2e/vsix/continue-lite.vsix"

