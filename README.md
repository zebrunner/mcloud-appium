## Ansible script to prepare Appium and OpenCV components for MCloud (Android)

We have to run it at once for porting new version of Appium/OpenCV and publish manually to public s3 storage
> make sure to provide public access after redownload for appium.tar.gz and/or opencv.tar.gz 
File `defaults/main.yml` contains main Ansible variables

#### Main tasks:
 *  appium - install shared appium with all required components
 *  opencv - install shared opencv components

#### Main playbooks:
 *  appium.yml - install and pack shared appium components including android-sdk
 *  opencv.yml - install and pack shared opencv components

#### Example of the appium setup:
`ansible-playbook -vvv -i hosts appium.yml`

