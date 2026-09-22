#!/bin/sh
# The container runs under the caller's uid (see currentUser in
# src/utils/docker.ts), which has no /etc/passwd entry. Node then fails any
# os.userInfo() call with ENOENT on uv_os_get_passwd, and npm makes one while
# installing the Capacitor dependencies. Declaring the uid fixes it; the file is
# writable by group root, which is the group the container runs with.
set -e

if ! getent passwd "$(id -u)" >/dev/null 2>&1; then
  printf 'builder:x:%s:%s:html2apk:%s:/bin/sh\n' \
    "$(id -u)" "$(id -g)" "${HOME:-/home/builder}" >> /etc/passwd || \
    echo "html2apk: impossible de déclarer l'utilisateur $(id -u) dans /etc/passwd" >&2
fi

exec node /opt/html2apk/dist/cli.js "$@"
