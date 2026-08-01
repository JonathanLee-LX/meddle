#!/usr/bin/env bash
set -euo pipefail

REPO="JonathanLee-LX/meddle"
INSTALL_DIR="${MEDDLE_BIN_DIR:-$HOME/.meddle/bin}"
VERSION="${MEDDLE_VERSION:-latest}"

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
    Linux)  OS_TAG="linux" ;;
    Darwin) OS_TAG="darwin" ;;
    *)      echo "Unsupported OS: $OS"; exit 1 ;;
esac

case "$ARCH" in
    x86_64|amd64)   ARCH_TAG="x64" ;;
    aarch64|arm64)  ARCH_TAG="arm64" ;;
    *)              echo "Unsupported arch: $ARCH"; exit 1 ;;
esac

ASSET="meddle-${OS_TAG}-${ARCH_TAG}"

if [ "$VERSION" = "latest" ]; then
    echo "Fetching latest release..."
    VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed 's/.*"v\(.*\)".*/\1/')
    if [ -z "$VERSION" ]; then
        echo "Error: could not determine latest version"; exit 1
    fi
fi

TAG="v${VERSION}"
URL="https://github.com/${REPO}/releases/download/${TAG}/${ASSET}"
SHA_URL="${URL}.sha256"

echo "Installing meddle ${TAG} (${OS_TAG}-${ARCH_TAG})..."

mkdir -p "$INSTALL_DIR"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "Downloading ${URL}..."
curl -fSL --retry 3 -o "${TMP}/${ASSET}" "$URL"

echo "Verifying checksum..."
if curl -fsSL --retry 3 -o "${TMP}/${ASSET}.sha256" "$SHA_URL" 2>/dev/null; then
    cd "$TMP"
    sha256sum -c "${ASSET}.sha256" --quiet 2>/dev/null || shasum -a 256 -c "${ASSET}.sha256" --quiet
    cd - >/dev/null
    echo "Checksum OK"
else
    echo "Warning: checksum file not available, skipping verification"
fi

mv "${TMP}/${ASSET}" "${INSTALL_DIR}/meddle"
chmod +x "${INSTALL_DIR}/meddle"

echo ""
echo "meddle ${TAG} installed to ${INSTALL_DIR}/meddle"

if ! echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
    echo ""
    echo "Add to your PATH:"
    echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
    echo ""
    SHELL_RC=""
    case "${SHELL:-}" in
        */zsh)  SHELL_RC="$HOME/.zshrc" ;;
        */bash) SHELL_RC="$HOME/.bashrc" ;;
    esac
    if [ -n "$SHELL_RC" ]; then
        echo "Or run:"
        echo "  echo 'export PATH=\"${INSTALL_DIR}:\$PATH\"' >> ${SHELL_RC}"
    fi
fi

echo ""
echo "Verify: ${INSTALL_DIR}/meddle version"
