const kkiapay = require('..');

const k = kkiapay({
  publickey: 'LprYUAyMpfAjq4z2yTHPiY0b6XktIQ',
  privatekey: 'pk_3c30e49040bb11e991519dc1901933da',
  secretkey: 'sk_3c30e49140bb11e991519dc1901933da',
  sandbox: false,
});

k.verify('6772884587476727')
  .then((response) => {
    console.log(response);
  })
  .catch((error) => {
    console.log(error);
  });
