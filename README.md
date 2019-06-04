## Ansible script to setup infrastructure of running Appium tests on MCloud (Android)

File `hosts` contains server addresses to setup

File `defaults/main.yml` contains main Ansible tasks

#### Main tasks:
 *  appium - install shared appium with all required components
 *  devices - setup server to which real devices will be connected
 *  docker - install docker components
 *  emulators - setup server to work with emulators
 *  grid-router - setup selenium-hub

#### Main playbooks:
 *  emulators.yml - setup server(s) to work with emulators
 *  devices.yml - setup server(s) to work with real devices
 *  router.yml - setup selenium-hub for devices

#### Example of the setup server to work with emulators:
`ansible-playbook -vvv -i hosts emulators.yml`
`ansible-playbook -vvv -i hosts devices.yml`
