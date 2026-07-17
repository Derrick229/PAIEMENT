# Démo Paiement KKiaPay (mode Sandbox)

Petite plateforme : un bouton **Payer**, redirection vers le widget KKiaPay,
vérification du paiement côté serveur, et historique des transactions
(Payé / Échoué / En attente).

## Comment ça marche

1. Le client remplit un montant et clique sur **Payer avec KKiaPay**.
2. Le widget KKiaPay s'ouvre (modal, pas besoin de quitter la page) en mode `sandbox`.
3. Une fois le paiement tenté, KKiaPay renvoie un `transactionId` au frontend.
4. Le frontend envoie ce `transactionId` au backend (`/api/transactions/verify`).
5. **Le backend revérifie TOUJOURS la transaction auprès de KKiaPay** (avec ta clé
   privée) avant d'afficher "Payé" — on ne fait jamais confiance au seul statut
   renvoyé côté navigateur, ça évite qu'un utilisateur triche en manipulant le JS.
6. Le résultat (SUCCESS / FAILED / PENDING) est enregistré dans `transactions.json`
   et affiché dans le tableau d'historique.

## 1. Créer un compte KKiaPay (Sandbox)

1. Va sur https://app.kkiapay.me et crée un compte marchand.
2. Active le **mode Sandbox** dans le dashboard.
3. Récupère 3 clés dans Dashboard > Paramètres > Clés API :
   - Clé publique (`publickey`)
   - Clé privée (`privatekey`)
   - Clé secrète (`secretkey`)
4. En sandbox, KKiaPay fournit des numéros de téléphone de test (mobile money)
   pour simuler un paiement réussi ou échoué — regarde la page
   "KKiaPay Sandbox : Guide de Test" de leur documentation pour les numéros à jour.

## 2. Installation

```bash
cd kkiapay-demo
cp .env.example .env
# puis édite .env et colle tes 3 clés sandbox
npm install
npm start
```

Le serveur démarre sur http://localhost:3000

## 3. Tester

1. Ouvre http://localhost:3000
2. Renseigne un montant (ex : 1000 FCFA), clique sur "Payer avec KKiaPay"
3. Dans le widget, utilise un numéro de test sandbox fourni par KKiaPay
4. Regarde le statut s'afficher, et la ligne apparaître dans l'historique

## Structure du projet

```
kkiapay-demo/
├── server.js              # API : /api/config, /api/transactions, /api/transactions/verify
├── public/
│   └── index.html          # Frontend : bouton payer + historique
├── transactions.json        # "Base de données" (créée automatiquement)
├── .env                    # Tes clés KKiaPay (ne jamais commit !)
└── package.json
```

## Aller plus loin (recommandé avant la prod)

- **Webhook KKiaPay** : configure dans le dashboard KKiaPay une URL de webhook
  pointant vers `/api/kkiapay/webhook` (utilise `ngrok` en local pour exposer
  ton serveur). Ça garantit que le statut est mis à jour même si l'utilisateur
  ferme l'onglet avant la vérification côté client.
- **Base de données réelle** : remplacer `transactions.json` par MySQL/PostgreSQL
  pour un usage en production (le fichier JSON est fait pour la démo/sandbox).
- **Authentification** : si la plateforme a des comptes utilisateurs, lie chaque
  transaction à un `userId` pour que l'historique soit filtré par client.
- **Montant contrôlé côté serveur** : pour éviter qu'un client modifie le montant
  dans le JS avant paiement, calcule/valide le montant attendu côté serveur
  (ex : à partir du prix de la recharge moto) plutôt que de faire confiance
  totalement à l'input du formulaire.
