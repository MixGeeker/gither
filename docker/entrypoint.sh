#!/bin/sh
set -eu
case "${1:-serve}" in
 serve) exec node .server-dist/index.js ;;
 setup|reset-owner|backup) exec node .server-dist/cli.js "$@" ;;
 *) echo 'Use serve, setup, reset-owner or backup.' >&2; exit 2 ;;
esac
