## mcloud-appium

Script to prepare Appium and OpenCV components for MCloud (Android)
1. run `build.sh` for building new version of Appium/OpenCV
2. publish manually to zebrunner-ce s3 storage 
`aws s3 cp appium.tar.gz s3://zebrunner-ce/mcloud/develop/appium.tar.gz`
> make sure to provide public access after redownload for appium.tar.gz
