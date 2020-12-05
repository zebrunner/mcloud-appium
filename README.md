## Ansible script to setup appium and opencv components for MCloud (Android)

File `defaults/main.yml` contains main Ansible variables

#### Main tasks:
 *  appium - install shared appium with all required components
 *  opencv - install shared opencv components

#### Main playbooks:
 *  appium.yml - install and pack shared appium components including android-sdk
 *  opencv.yml - install and pack shared opencv components

#### Example of the appium setup:
`ansible-playbook -vvv -i hosts appium.yml`

