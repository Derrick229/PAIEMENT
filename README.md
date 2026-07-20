# XSMARTPUMP — Distributeur automatique avec paiement KKiaPay

Plateforme pour distributeur automatique de liquide :
- Le client saisit une quantité (L), le prix est calculé automatiquement (non modifiable)
- Paiement via KKiaPay (sandbox)
- Après paiement confirmé : message "préparez votre récipient" + reçu à l'écran + reçu par email
- Admin : historique complet et permanent (base de données), filtres par date/statut, graphiques,
  gestion du prix au litre, suivi du stock restant, marquage "livré"
- Prêt à être branché plus tard à un ESP32 (capteur de niveau + confirmation de livraison réelle)

## 1. Créer la base de données (Supabase — gratuite et permanente)

1. Va sur https://supabase.com et crée un compte (tu peux te connecter avec GitHub)
2. Clique **New project**, donne-lui un nom (ex: `xsmartpump`), choisis un mot de passe pour
   la base (note-le bien, tu en as besoin après), choisis une région proche, clique **Create**
3. Attends 1-2 minutes que le projet soit prêt
4. Dans le menu de gauche : **SQL Editor** → **New query**
5. Ouvre le fichier `schema.sql` (fourni avec ce projet), copie tout son contenu, colle-le dans
   l'éditeur SQL de Supabase, puis clique **Run**. Ça crée les tables nécessaires.
6. Va dans **Project Settings** (icône engrenage) → **Database** → section **Connection string**
   → onglet **URI**. Copie l'URL affichée (elle commence par `postgresql://postgres:...`).
   Remplace `[YOUR-PASSWORD]` dans cette URL par le mot de passe que tu as choisi à l'étape 2.
   C'est cette URL complète qui va dans `DATABASE_URL` dans ton `.env`.

## 2. Créer un compte Gmail dédié pour l'envoi des reçus (optionnel mais activé par défaut ici)

1. Utilise un compte Gmail existant, ou crée un compte Gmail dédié à XSMARTPUMP
2. Active la validation en 2 étapes sur ce compte (obligatoire pour l'étape suivante) :
   myaccount.google.com/security → "Validation en 2 étapes" → active-la
3. Toujours dans myaccount.google.com/security, cherche **"Mots de passe des applications"**
   (App passwords). Si tu ne le vois pas directement, cherche "App passwords" dans la barre de
   recherche des paramètres Google.
4. Crée un mot de passe d'application (nom libre, ex: "xsmartpump"). Google te donne un code de
   16 caractères → **note-le**, c'est lui qui va dans `SMTP_PASS` (pas ton vrai mot de passe Gmail)

## 3. Configurer le fichier .env

```bash
cd xsmartpump
cp .env.example .env
```

Édite `.env` et remplis :
- `KKIAPAY_PUBLIC_KEY`, `KKIAPAY_PRIVATE_KEY`, `KKIAPAY_SECRET_KEY` → tes clés sandbox KKiaPay
- `ADMIN_PASSWORD` → le mot de passe que tu veux pour te connecter à `/admin`
- `SESSION_SECRET` → n'importe quelle longue phrase aléatoire
- `DATABASE_URL` → l'URL Supabase récupérée à l'étape 1.6
- `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER=tonadresse@gmail.com`,
  `SMTP_PASS=le-code-16-caracteres`, `SMTP_FROM=tonadresse@gmail.com`
- `ESP32_API_KEY` → n'importe quelle chaîne secrète (utile seulement quand tu brancheras l'ESP32)

## 4. Installer et lancer

```bash
npm install
npm start
```

Ouvre http://localhost:3000 pour la page client, et http://localhost:3000/admin pour l'admin.

## 5. Déployer sur Render

Sur ton service Render existant, va dans **Environment** et ajoute/mets à jour **toutes** les
variables listées ci-dessus (les mêmes valeurs que dans ton `.env` local). Fais un nouveau
`git push` pour envoyer le nouveau code — Render redéploiera automatiquement.

⚠️ Important : ne mets JAMAIS `DATABASE_URL`, les clés KKiaPay, ou `SMTP_PASS` directement dans
le code ou sur GitHub — uniquement dans les variables d'environnement de Render.

## Comment ça marche (flux de paiement)

1. Le client saisit une quantité → le frontend appelle `/api/orders/create`
2. Le serveur calcule le prix à partir de la valeur réelle en base (le client ne peut pas le
   trafiquer), crée une commande "PENDING", renvoie un `orderId` + le montant exact
3. Le widget KKiaPay s'ouvre avec ce montant exact
4. Après tentative de paiement, le frontend envoie `orderId` + `transactionId` à
   `/api/transactions/verify`
5. Le serveur revérifie **toujours** auprès de KKiaPay (jamais confiance au navigateur), compare
   le montant réellement payé à celui attendu, et met à jour le statut (SUCCESS/FAILED)
6. Si SUCCESS : message de préparation + reçu à l'écran + email envoyé si une adresse a été fournie

## Espace admin (`/admin`, protégé par mot de passe)

- **Graphiques** : revenu des 30 derniers jours, réussis vs échoués
- **Réglages** : prix au litre, stock restant, capacité totale du réservoir
- **Historique** : filtrable par date, statut, ou recherche (référence/email)
- **Colonne "Servi ?"** : bouton pour marquer manuellement une commande comme livrée
  (décrémente automatiquement le stock restant) — en attendant que l'ESP32 le fasse tout seul
- **Mode sombre / clair** : bouton en haut à droite, mémorisé dans le navigateur

## Pour plus tard : brancher l'ESP32

Un endpoint est déjà prêt : `POST /api/esp32/tank-level` avec un header `x-esp32-key` correspondant
à `ESP32_API_KEY`, et un body `{ "tankRemainingLiters": 123 }`. Quand ton ESP32 sera connecté à un
capteur de niveau, il pourra appeler cette route périodiquement pour mettre à jour le stock en
temps réel dans l'admin.

Pour la confirmation réelle de livraison (l'ESP32 confirmant que la pompe a bien délivré la
quantité), on pourra créer un endpoint similaire quand tu seras prêt à câbler cette partie.

## Sécurité — pourquoi certains choix ont été faits

- Le **prix est toujours calculé côté serveur**, jamais fait confiance à ce que le navigateur
  envoie, pour éviter qu'un client modifie le montant avant paiement.
- Le **montant réellement payé est comparé** au montant attendu de la commande avant de valider
  un paiement comme réussi.
- Les clés secrètes (KKiaPay, base de données, email) ne sont **jamais** exposées au navigateur,
  seulement utilisées côté serveur.
