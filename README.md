## mcloud-appium

Script to prepare Appium with opencv4nodejs component for MCloud (Android)
1. run `build.sh` to build new artifact 
2. publish manually to zebrunner-ce s3 storage 
`aws s3 cp appium.tar.gz s3://zebrunner-ce/mcloud/develop/appium.tar.gz`
> make sure to provide public access after redownload for appium.tar.gz
