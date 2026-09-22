# Build environment for html2apk: Node.js 22, JDKs, Android SDK, Gradle and
# Bubblewrap, so both builders (URL and local folder) can run in a container.
FROM node:22-bookworm-slim

# Pinned tool versions. cmdline-tools ships the sdkmanager used below.
ARG ANDROID_CMDLINE_TOOLS_VERSION=11076708
ARG ANDROID_PLATFORM=36
ARG ANDROID_BUILD_TOOLS=36.0.0
ARG GRADLE_VERSION=8.13
ARG BUBBLEWRAP_VERSION=1.25.0

ENV ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk \
    GRADLE_HOME=/opt/gradle \
    GRADLE_USER_HOME=/home/builder/.gradle \
    HOME=/home/builder \
    HTML2APK_IN_CONTAINER=1 \
    DEBIAN_FRONTEND=noninteractive

# JDK 17 is what Bubblewrap expects; JDK 21 is required by the Capacitor 8
# Android template (it compiles with sourceCompatibility 21), so both are
# installed and JAVA_HOME points at 21 for the Gradle builds.
ENV JAVA_HOME=/usr/lib/jvm/temurin-21-jdk-amd64 \
    JAVA_HOME_17=/usr/lib/jvm/java-17-openjdk-amd64 \
    JAVA_HOME_21=/usr/lib/jvm/temurin-21-jdk-amd64

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      ca-certificates curl unzip git openssh-client gnupg \
      openjdk-17-jdk-headless; \
    # Bookworm ships no JDK 21, not even in backports, so it comes from Adoptium.
    install -d -m 0755 /etc/apt/keyrings; \
    curl -fsSL https://packages.adoptium.net/artifactory/api/gpg/key/public \
      | gpg --dearmor -o /etc/apt/keyrings/adoptium.gpg; \
    echo "deb [signed-by=/etc/apt/keyrings/adoptium.gpg] https://packages.adoptium.net/artifactory/deb bookworm main" \
      > /etc/apt/sources.list.d/adoptium.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends temurin-21-jdk; \
    rm -rf /var/lib/apt/lists/*; \
    test -x "$JAVA_HOME/bin/javac"; \
    test -x "$JAVA_HOME_17/bin/javac"

# Android SDK: command-line tools, platform-tools and build-tools.
RUN set -eux; \
    mkdir -p "$ANDROID_HOME/cmdline-tools"; \
    curl -fsSL -o /tmp/cmdline-tools.zip \
      "https://dl.google.com/android/repository/commandlinetools-linux-${ANDROID_CMDLINE_TOOLS_VERSION}_latest.zip"; \
    unzip -q /tmp/cmdline-tools.zip -d "$ANDROID_HOME/cmdline-tools"; \
    mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"; \
    rm /tmp/cmdline-tools.zip; \
    yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses > /dev/null; \
    "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --install \
      "platform-tools" \
      "platforms;android-${ANDROID_PLATFORM}" \
      "build-tools;${ANDROID_BUILD_TOOLS}" > /dev/null

ENV PATH="${PATH}:/opt/android-sdk/cmdline-tools/latest/bin:/opt/android-sdk/platform-tools:/opt/android-sdk/build-tools/36.0.0:/opt/gradle/bin"

# Gradle. Capacitor projects use their own wrapper, but a system Gradle is
# available for direct invocations.
RUN set -eux; \
    curl -fsSL -o /tmp/gradle.zip \
      "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip"; \
    unzip -q /tmp/gradle.zip -d /opt; \
    mv "/opt/gradle-${GRADLE_VERSION}" /opt/gradle; \
    rm /tmp/gradle.zip; \
    gradle --version > /dev/null

RUN npm install -g "@bubblewrap/cli@${BUBBLEWRAP_VERSION}"

# Seed Bubblewrap's config so it uses the SDK and JDK 17 already installed
# here instead of downloading its own copies on first run.
RUN set -eux; \
    mkdir -p "$HOME/.bubblewrap"; \
    printf '{"jdkPath":"%s","androidSdkPath":"%s"}\n' "$JAVA_HOME_17" "$ANDROID_HOME" \
      > "$HOME/.bubblewrap/config.json"

WORKDIR /opt/html2apk
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# The container is run with the caller's uid/gid so the APK it writes into the
# mounted output directory is owned by that user, hence the loose permissions
# on everything a build has to write to.
RUN set -eux; \
    mkdir -p /home/builder/.gradle /work/src /work/out; \
    chmod -R a+rwX /home/builder /work; \
    chmod -R a+rwX "$ANDROID_HOME"; \
    # That uid has no passwd entry, which breaks Node's os.userInfo(); the
    # entrypoint adds one, so group root must be able to write the file.
    chgrp 0 /etc/passwd; \
    chmod g+w /etc/passwd

COPY docker-entrypoint.sh /usr/local/bin/html2apk-entrypoint
RUN chmod 0755 /usr/local/bin/html2apk-entrypoint

WORKDIR /work
ENTRYPOINT ["/usr/local/bin/html2apk-entrypoint"]
CMD ["--help"]
