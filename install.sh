#!/usr/bin/env sh
# Neuroartist CLI installer.
#
#   curl -fsSL https://raw.githubusercontent.com/CroissanStudioDev/neuroartist-api-cli/main/install.sh | sh
#
# Optional version pin:
#   curl -fsSL https://...install.sh | sh -s -- v0.1.1
#
# Optional install dir:
#   NEUROARTIST_INSTALL=/opt/neuroartist sh install.sh

set -e

REPO="CroissanStudioDev/neuroartist-api-cli"
VERSION="${1:-latest}"
INSTALL_DIR="${NEUROARTIST_INSTALL:-$HOME/.neuroartist}"
BIN_DIR="$INSTALL_DIR/bin"
EXE="$BIN_DIR/na"

red()    { printf '\033[31m%s\033[0m\n' "$*" >&2; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
dim()    { printf '\033[2m%s\033[0m\n' "$*"; }
bold()   { printf '\033[1m%s\033[0m\n' "$*"; }

require() {
    if ! command -v "$1" >/dev/null 2>&1; then
        red "Missing required command: $1"
        exit 1
    fi
}

require curl
require tar
require uname

# --- Detect platform ---
case "$(uname -s)" in
    Linux*)  OS=linux ;;
    Darwin*) OS=darwin ;;
    *)
        red "Unsupported OS: $(uname -s)"
        red "Windows users — download the .zip from https://github.com/$REPO/releases"
        exit 1
        ;;
esac

case "$(uname -m)" in
    x86_64|amd64)  ARCH=x64 ;;
    arm64|aarch64) ARCH=arm64 ;;
    *)
        red "Unsupported architecture: $(uname -m)"
        exit 1
        ;;
esac

ASSET="na-${OS}-${ARCH}.tar.gz"

# --- Build URL ---
if [ "$VERSION" = "latest" ]; then
    URL="https://github.com/$REPO/releases/latest/download/$ASSET"
else
    case "$VERSION" in
        v*) ;;          # already prefixed
        *) VERSION="v$VERSION" ;;
    esac
    URL="https://github.com/$REPO/releases/download/$VERSION/$ASSET"
fi

# --- Download + extract ---
mkdir -p "$BIN_DIR"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT INT TERM

dim "Target: $OS-$ARCH"
dim "Source: $URL"

if ! curl --fail --location --progress-bar --output "$TMP/na.tar.gz" "$URL"; then
    red "Download failed."
    red "Verify the version exists: https://github.com/$REPO/releases"
    exit 1
fi

tar -xzf "$TMP/na.tar.gz" -C "$TMP"

if [ ! -f "$TMP/na-${OS}-${ARCH}" ]; then
    red "Extracted archive does not contain expected binary 'na-${OS}-${ARCH}'."
    exit 1
fi

mv "$TMP/na-${OS}-${ARCH}" "$EXE"
chmod +x "$EXE"

# Strip macOS quarantine attribute so Gatekeeper doesn't block first run.
if [ "$OS" = "darwin" ] && command -v xattr >/dev/null 2>&1; then
    xattr -d com.apple.quarantine "$EXE" 2>/dev/null || true
fi

# --- Verify ---
INSTALLED_VERSION="$("$EXE" --version 2>/dev/null || echo unknown)"

# --- PATH integration ---
# Use $HOME-relative form when possible so the profile entry survives a moved $HOME.
HOME_REL_BIN=""
case "$BIN_DIR" in
    "$HOME"/*) HOME_REL_BIN="\$HOME/${BIN_DIR#$HOME/}" ;;
esac

SHELL_PROFILE=""
if [ -n "$HOME_REL_BIN" ]; then
    PATH_LINE_BASH="export PATH=\"$HOME_REL_BIN:\$PATH\""
    PATH_LINE_FISH="set -gx PATH \"$HOME_REL_BIN\" \$PATH"
else
    PATH_LINE_BASH="export PATH=\"$BIN_DIR:\$PATH\""
    PATH_LINE_FISH="set -gx PATH \"$BIN_DIR\" \$PATH"
fi
PATH_LINE="$PATH_LINE_BASH"

case "${SHELL:-}" in
    */zsh)  SHELL_PROFILE="$HOME/.zshrc" ;;
    */bash)
        if [ -f "$HOME/.bashrc" ]; then
            SHELL_PROFILE="$HOME/.bashrc"
        elif [ -f "$HOME/.bash_profile" ]; then
            SHELL_PROFILE="$HOME/.bash_profile"
        fi
        ;;
    */fish)
        SHELL_PROFILE="$HOME/.config/fish/config.fish"
        PATH_LINE="$PATH_LINE_FISH"
        ;;
esac

PATH_ALREADY_SET=0
case ":$PATH:" in
    *":$BIN_DIR:"*) PATH_ALREADY_SET=1 ;;
esac

PROFILE_HAS_LINE=0
if [ -n "$SHELL_PROFILE" ] && [ -f "$SHELL_PROFILE" ]; then
    if grep -qsF "$BIN_DIR" "$SHELL_PROFILE" || \
       ([ -n "$HOME_REL_BIN" ] && grep -qsF "$HOME_REL_BIN" "$SHELL_PROFILE"); then
        PROFILE_HAS_LINE=1
    fi
fi

if [ "$PROFILE_HAS_LINE" -eq 0 ] && [ -n "$SHELL_PROFILE" ]; then
    {
        echo ""
        echo "# Added by Neuroartist CLI installer"
        echo "$PATH_LINE"
    } >> "$SHELL_PROFILE"
    dim "Added PATH entry to $SHELL_PROFILE"
fi

# --- Done ---
echo ""
green "✔ Installed Neuroartist CLI $INSTALLED_VERSION at $EXE"

if [ "$PATH_ALREADY_SET" -eq 0 ]; then
    echo ""
    bold "Next:"
    if [ -n "$SHELL_PROFILE" ]; then
        echo "  source \"$SHELL_PROFILE\"     # or open a new terminal"
    else
        echo "  Add this to your shell profile:"
        echo "  $PATH_LINE"
    fi
    echo "  na auth login"
else
    echo ""
    bold "Next:"
    echo "  na auth login"
fi
