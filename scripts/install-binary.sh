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
    *)      echo "error: unsupported OS: $OS"; exit 1 ;;
esac

case "$ARCH" in
    x86_64|amd64)   ARCH_TAG="x64" ;;
    aarch64|arm64)  ARCH_TAG="arm64" ;;
    *)              echo "error: unsupported arch: $ARCH"; exit 1 ;;
esac

ASSET="meddle-${OS_TAG}-${ARCH_TAG}"

if [ "$VERSION" = "latest" ]; then
    VERSION=$(curl -s -o /dev/null -w '%{redirect_url}' "https://github.com/${REPO}/releases/latest" | sed 's|.*/tag/v||')
    if [ -z "$VERSION" ]; then
        echo "error: could not determine latest version"; exit 1
    fi
fi

TAG="v${VERSION}"
URL="https://github.com/${REPO}/releases/download/${TAG}/${ASSET}"
SHA_URL="${URL}.sha256"

echo "==> Installing meddle ${TAG} (${OS_TAG}/${ARCH_TAG})"

mkdir -p "$INSTALL_DIR"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "    Downloading ${ASSET}..."
curl -fL --retry 3 --progress-bar -o "${TMP}/${ASSET}" "$URL"

printf "    Verifying checksum..."
if curl -fsSL --retry 3 -o "${TMP}/${ASSET}.sha256" "$SHA_URL" 2>/dev/null; then
    (cd "$TMP" && sha256sum -c "${ASSET}.sha256" --quiet 2>/dev/null || shasum -a 256 -c "${ASSET}.sha256" >/dev/null)
    echo " ok"
else
    echo " skipped (not available)"
fi

mv "${TMP}/${ASSET}" "${INSTALL_DIR}/meddle"
chmod +x "${INSTALL_DIR}/meddle"

echo ""
echo "==> meddle ${TAG} installed to ${INSTALL_DIR}/meddle"

if ! echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
    SHELL_RC=""
    case "${SHELL:-}" in
        */zsh)  SHELL_RC="$HOME/.zshrc" ;;
        */bash) SHELL_RC="$HOME/.bashrc" ;;
    esac
    echo ""
    echo "    Add to PATH:"
    echo "      export PATH=\"${INSTALL_DIR}:\$PATH\""
    if [ -n "$SHELL_RC" ]; then
        echo "      echo 'export PATH=\"${INSTALL_DIR}:\$PATH\"' >> ${SHELL_RC} && source ${SHELL_RC}"
    fi
fi

echo ""
echo "    Verify: ${INSTALL_DIR}/meddle version"
