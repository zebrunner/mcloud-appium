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

#### Example of the setup server to work with devices:
`ansible-playbook -vvv -i hosts devices.yml`

#### Example of the setup server to work with devices using secure https/wss connection:
`ansible-playbook -vvv -i hosts --extra-vars "ssl_crt=/home/ubuntu/tools/qps-infra/nginx/ssl/ssl.crt ssl_key=/home/ubuntu/tools/qps-infra/nginx/ssl/ssl.key" devices.yml`

Note: ssl.crt and ssl.key will be copied into the /opt/nginx folder and shared correctly to the device container.

#### How to add new devices:

Add your device data to `roles/devices/vars/main.yml`

Execute command: `ansible-playbook -vvv -i hosts devices.yml --tags "registerDevice"` 

Connect your device.


