#!/usr/bin/env bash
# Сверка: файлы, собранные сейчас из тега, байт в байт те же, что лежат в
# релизе этого тега. Только при совпадении свидетельство происхождения,
# выданное задним числом, говорит правду: «эти байты собраны из этого тега».
#
#   same-as-release.sh <папка сборки> <папка с файлами релиза>
#
# Код 0 — все три файла совпали; 1 — хоть один разошёлся или отсутствует
# (с какой стороны — сказано словами); 2 — неверный вызов.
set -u

if [ "$#" -ne 2 ]; then
  echo "вызов: same-as-release.sh <папка сборки> <папка с файлами релиза>" >&2
  exit 2
fi

built="$1"
released="$2"
status=0

digest() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

for name in main.js manifest.json styles.css; do
  if [ ! -f "$built/$name" ]; then
    echo "нет $name в сборке ($built)" >&2
    status=1
    continue
  fi
  if [ ! -f "$released/$name" ]; then
    echo "нет $name в релизе ($released)" >&2
    status=1
    continue
  fi
  a="$(digest "$built/$name")"
  b="$(digest "$released/$name")"
  if [ "$a" != "$b" ]; then
    echo "$name разошёлся: сборка $a, релиз $b" >&2
    status=1
  else
    echo "$name совпал: $a"
  fi
done

exit "$status"
