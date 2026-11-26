#!/usr/bin/env bash
# Formate en silence le fichier Rust qu'un agent vient d'éditer : le diff reste propre et
# `cargo xtask check` n'échoue jamais sur un simple formatage.
file=$(sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
if [[ "$file" == *.rs && -f "$file" ]]; then
  rustfmt --quiet "$file" >/dev/null 2>&1
fi
exit 0
