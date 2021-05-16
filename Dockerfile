FROM ubuntu:16.04

ENV MCLOUD_HOME=/opt/mcloud

#android-sdk-linux can't be renamed as it is existing folder inside Android SDK archive
ENV ANDROID_HOME=${MCLOUD_HOME}/android-sdk-linux
ENV PATH=${ANDROID_HOME}/platform-tools:${ANDROID_HOME}/build-tools:$PATH


ENV ANDROID_SDK_ARCHIVE=android-sdk_r24.4.1-linux.tgz
ENV ANDROID_SDK_DOWNLOAD_LOCATION=https://dl.google.com/android/${ANDROID_SDK_ARCHIVE}
ENV ANDROID_BUILD_TOOLS=build-tools-29.0.3

ENV APPIUM_VERSION=1.19.0
ENV APPIUM_HOME=${MCLOUD_HOME}/appium
ENV OPENCV_VERSION=4.15.0

RUN apt-get update \
    && apt-get install -y \
	curl \
	git \
	cmake \
	build-essential \
	openjdk-8-jdk

RUN export

# Install 8.x and 10.x node and npm (6.x)
RUN curl -sL https://deb.nodesource.com/setup_10.x | bash - \
    && apt-get install -y nodejs

#===============
# Set JAVA_HOME
#===============
ENV JAVA_HOME="/usr/lib/jvm/java-8-openjdk-amd64/jre"

# Install and upgrade Android SDK tools
RUN curl -O ${ANDROID_SDK_DOWNLOAD_LOCATION} \
    && mkdir -p ${MCLOUD_HOME} \
    && tar -xf ${ANDROID_SDK_ARCHIVE} -C ${MCLOUD_HOME} \
    && rm -f ${ANDROID_SDK_ARCHIVE} \
    && echo y | ${ANDROID_HOME}/tools/android update sdk --filter "platform-tools,${ANDROID_BUILD_TOOLS}" --no-ui -a --force \
    && rm -rf ${ANDROID_HOME}/add-ons ${ANDROID_HOME}/platforms ${ANDROID_HOME}/SDK\ Readme.txt ${ANDROID_HOME}/temp ${ANDROID_HOME}/tools
    
RUN npm install appium@${APPIUM_VERSION} opencv4nodejs@${OPENCV_VERSION} --prefix ${APPIUM_HOME} --unsafe-perm true


# IMPORTANT: every time you upgrade appium version please make sure to patch manually
# PATCH #1: <appium>/node_modules/appium-adb/build/lib/tools/adb-commands.js to fix pidof identification on screenrecord
# for 1.19.0 replace 678 and 681 lines using below
# 678 line:
#    const shellCommand = this._isPgrepAvailable ? this._canPgrepUseFullCmdLineSearch ? ['pgrep', '-f', _lodash.default.escapeRegExp(`([[:blank:]]|^)${name}([[:blank:]]|$)`)] : [`pgrep ^${_lodash.default.escapeRegExp(name.slice(-MAX_PGR$
#updated one:
#    const shellCommand = this._isPgrepAvailable ? this._canPgrepUseFullCmdLineSearch ? ['pgrep', '-f', _lodash.default.escapeRegExp(`([[:blank:]]|^)${name}([[:blank:]]|$)`)] : [`pgrep ^${_lodash.default.escapeRegExp(name.slice(-MAX_PGR$
#
# 681 line:
#      return (await this.shell(shellCommand)).split(/\s+/).map(x => parseInt(x, 10)).filter(x => _lodash.default.isInteger(x));
# updated one:
#      return (await this.shell(shellCommand)).split(" 5037")[0].split(/\s+/).map(x => parseInt(x, 10)).filter(x => _lodash.default.isInteger(x));

# PATCH #2 <appium>/node_modules/appium/node_modules/appium-base-driver/build/lib/protocol/protocol.js to return to carina "DEBUG info" about problematic step
# after 303 line add one more to update err.message
#       let actualErr = err;
#      err.message = `[[[DEBUG info: ${err.message} --udid ${process.env.DEVICE_UDID} --name ${process.env.STF_PROVIDER_DEVICE_NAME}]]]`;


# adb-commands.js - hotfix for screenrecord pidof functionality
COPY files/appium/${APPIUM_VERSION}/adb-commands.js ${APPIUM_HOME}/node_modules/appium/node_modules/appium-adb/build/lib/tools/adb-commands.js

# protocol.js - return extra informationin logs about failure
COPY files/appium/${APPIUM_VERSION}/protocol.js ${APPIUM_HOME}/node_modules/appium/node_modules/appium-base-driver/build/lib/protocol/protocol.js

# storage-client.js - fix for keeping executable permissions for new chromedrivers
COPY files/appium/${APPIUM_VERSION}/storage-client.js ${APPIUM_HOME}/node_modules/appium/node_modules/appium-chromedriver/build/lib/storage-client.js

RUN tar -czvf /appium.tar.gz /opt/mcloud
