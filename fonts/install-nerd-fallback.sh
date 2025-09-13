#!/usr/bin/env bash
set -euo pipefail

# Where your dotfiles live
DOTFILES="${DOTFILES:-$HOME/dotfiles}"

# 1) Stow the package (creates the symlinks for fonts + fontconfig)
cd "$DOTFILES"
stow -v fonts

# 2) Rebuild font cache (user scope is enough)
fc-cache -fv "$HOME/.local/share/fonts" >/dev/null

# 3) Show the Nerd fallback font so we know fontconfig sees it
echo "==> Installed Nerd fallback fonts:"
fc-list | grep -i "DejaVuSansMono Nerd Font Mono" || echo "WARNING: DejaVuSansMono Nerd Font Mono not visible to fontconfig"

# 4) Quick render tests
echo "==> Test glyphs:"
otfinfo -u ~/.local/share/fonts/"DejaVu Sans Mono"*.ttf 2>/dev/null | grep -i F7D3 && echo "ok" || echo "F7D3 not found"

# 5) Verify fallback decision for common Omakub primaries at U+F7D3
echo "==> Fallback check (showing DejaVu NF if primary lacks glyph)"

fallback_family="DejaVuSansMono Nerd Font"

for fam in \
  "Cascadia Mono" "Cascadia Code" \
  "CaskaydiaCove Nerd Font" "CaskaydiaMono Nerd Font" \
  "Fira Mono" "FiraCode Nerd Font" \
  "JetBrains Mono" "JetBrainsMono Nerd Font" \
  "MesloLGS NF" "MesloLGS Nerd Font"
do
  primary_file=$(fc-match -f '%{file}\n' "$fam" 2>/dev/null)
  has_glyph=$([ -n "$primary_file" ] && otfinfo -u "$primary_file" 2>/dev/null | grep -q F7D3 && echo YES || echo NO)

  if [ "$has_glyph" = "YES" ]; then
    show="$fam (has U+F7D3)"
  else
    show="$fallback_family (fallback)"
  fi

  printf "  %-24s -> %s\n" "$fam" "$show"
done


echo "Done. Now select your primary font in GNOME Terminal (e.g., CaskaydiaCove Nerd Font) and the fallback should supply U+F7D3."

