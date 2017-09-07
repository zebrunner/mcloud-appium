#!/bin/sh

ln -s /usr/lib/jvm/java-8-openjdk-amd64/bin/java /usr/bin/java \
    & /opt/configgen.sh > /opt/nodeconfig.json \
    & node /opt/appium/ -p $PORT --log-timestamp --session-override --udid $DEVICEUDID \
           --nodeconfig /opt/nodeconfig.json \
    & stf provider --name "$DEVICENAME-container" --min-port=$MIN_PORT --max-port=$MAX_PORT \
        --connect-sub tcp://213.184.251.86:7114 --connect-push tcp://213.184.251.86:7116 \
        --group-timeout 900 --public-ip smule.qaprosoft.com --storage-url http://smule.qaprosoft.com/ \
#	--adb_host=0.0.0.0 --adb_port=5037 \
        --vnc-initial-size 600x800
