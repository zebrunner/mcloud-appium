#!/bin/bash

#build docker image and copy generated mcloud.tar.gz archive into the 
docker build . -t mcloud-appium
docker run -v $PWD:/opt/mount --rm -ti mcloud-appium bash -c "cp /appium.tar.gz  /opt/mount/"
