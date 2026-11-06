#!/bin/sh
# bump the app version everywhere (service-worker cache name + ?v= on every script/style) so phones load the new release at once
cd "$(dirname "$0")/.." && N=$(($(grep -o "wmtl-v[0-9]*" sw.js | head -1 | tr -dc 0-9)+1))
sed -i "s/wmtl-v[0-9]*-/wmtl-v$N-/" sw.js && sed -i "s/?v=[0-9]*\"/?v=$N\"/g" index.html && echo "release v$N"
