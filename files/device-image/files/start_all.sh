#!/bin/sh

ln -s /usr/lib/jvm/java-8-openjdk-amd64/bin/java /usr/bin/java \
    & . /opt/configgen.sh > /opt/nodeconfig.json \
    & node /opt/appium/ -p $PORT --log-timestamp --session-override --udid $DEVICEUDID \
           --nodeconfig /opt/nodeconfig.json --automation-name $AUTOMATION_NAME \
    & stf provider --name "$DEVICENAME-container" --min-port=$MIN_PORT --max-port=$MAX_PORT \
        --connect-sub tcp://213.184.251.86:7114 --connect-push tcp://213.184.251.86:7116 \
        --group-timeout 3600 --public-ip smule.qaprosoft.com --storage-url http://smule.qaprosoft.com/ \
        --vnc-initial-size 600x800 --no-cleanup
