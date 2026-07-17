# KKIAPAY NODEJS-SDK

## Installing

Using npm:

```bash
npm i @kkiapay-org/nodejs-sdk
```

## Initialization

#### Production

```js
// setup your api key (https://www.kkiapay.me)
//initialize kkiapay in production environnment
const k = kkiapay({
  privatekey: 'xxxxxxx',
  publickey: 'xxxxxxx',
  secretkey: 'xxxxxxx',
});
```

#### Sandbox

```js
//initialize kkiapay in sandbox environnment
const k = kkiapay({
  privatekey: 'xxxxxxx',
  publickey: 'xxxxxxx',
  secretkey: 'xxxxxxx',
  sandbox: true,
});
```

## Request to retrieve transactions

#### EXAMPLE

```js
// Request to retrieve transactions
k.verify('transactionId')
  .then((response) => {
    //handle response
  })
  .catch((error) => {
    //handle error
  });
```

## Request to revert transaction

#### EXAMPLE

```js
// Request to retrieve transactions
k.refund('transactionId')
  .then((response) => {
    //handle response
  })
  .catch((error) => {
    //handle error
  });
```

## COMPLETE POSSIBLE STATUS LIST

| STATUS                             | DESCRIPTION                                                    |
| ---------------------------------- | -------------------------------------------------------------- |
| SUCCESS                            | Successful transaction                                         |
| FAILED                             | Transaction failed                                             |
| INSUFFICIENT_FUND                  | Not enough money in developper account                         |
| TRANSACTION_NOT_ELIGIBLE           | This transaction are already reverted or are not eligible      |
| TRANSACTION_NOT_FOUND              | Transaction not found                                          |
| INVALID_TRANSACTION                | You are not owner of this transaction                          |
| INVALID_TRANSACTION_TYPE           | We can't revert this transaction                               |
| INVALID_PAYOUT_DESTINATION_ACCOUNT | Provided destination account is not valid mobile money account |
