# ARGUMENTAIRE DE DÉMONSTRATION — PLATEFORME ROADSEN

**Destinataire : STARFIRE TECHNOLOGY SAS**
**Date : 27 juin 2026**
**Nature du document : support de séance, usage interne**

---

## 1. PITCH D'OUVERTURE

Vous nous avez confié une mission précise : donner à vos moteurs de calcul une présence web professionnelle, sécurisée et multi-tenant, utilisable par les bureaux d'études d'Afrique de l'Ouest sans que votre méthode ne soit exposée.

Ce que nous vous montrons aujourd'hui n'est pas une maquette. C'est la plateforme en fonctionnement réel : connexion sécurisée, espace de travail isolé par organisation, lancement d'un calcul chaussée avec vos algorithmes exécutés côté serveur, émission d'un procès-verbal scellé vérifiable. La science reste la vôtre — justesse des formules, cas-tests, conformité AGEROUTE. Le logiciel est le nôtre — infrastructure, sécurité, isolation, traçabilité.

L'objectif de cette séance est de co-valider les résultats de calcul que vous voyez à l'écran : sont-ils conformes aux sorties de référence de vos moteurs ? Votre verdict de validation est la porte de passage vers la livraison.

---

## 2. ARGUMENTAIRE PAR FONCTIONNALITÉ

### A — Isolation multi-tenant et contrôle d'accès

Chaque bureau d'études dispose d'un espace de travail étanche. Un tenant ne peut pas voir, même par erreur de navigation ou de paramètre d'URL, les projets ou les résultats d'un autre. Cette isolation est appliquée au niveau base de données (Row-Level Security), pas seulement à l'interface.

**Valeur pour STARFIRE :** vous commercialisez un service, pas un fichier partagé. Chaque client est un périmètre indépendant. Cela protège la réputation de STARFIRE en cas de litige inter-clients, et rend le produit crédible pour des BE qui traitent des données d'appels d'offres sensibles.

**Valeur pour les BE utilisateurs :** leurs projets, leurs paramètres et leurs PV leur appartiennent dans un espace qui n'est accessible à personne d'autre — y compris à d'autres clients ROADSEN.

---

### B — Gestion de projets

Un utilisateur crée un projet, y attache ses paramètres (structure de chaussée, trafic, sol), et retrouve son historique de calculs. La structure est pensée pour le quotidien d'un ingénieur de bureau d'études, pas pour un usage ponctuel.

**Valeur :** le BE peut suivre l'évolution d'une même variante sur plusieurs itérations, comparer des scénarios, et archiver proprement. Ce n'est plus un calcul jetable — c'est une base de travail documentée, vérifiable, opposable.

---

### C — Calcul chaussée avec verdict de conformité

Le calcul Burmister/AGEROUTE s'exécute intégralement côté serveur. Ce que vous voyez dans le navigateur — trafic NE, épaisseurs calculées, déformations sollicitantes comparées aux admissibles, verdict conforme/non conforme — est le résultat retourné après exécution, jamais la méthode elle-même.

**Valeur pour STARFIRE :** votre algorithme ne descend jamais dans le navigateur. Un utilisateur, même développeur, ne peut pas inspecter votre méthode via les outils du navigateur. La valeur intellectuelle de votre R&D reste protégée.

**Valeur pour les BE :** ils obtiennent un verdict clair, chiffré, sans avoir à maîtriser les formules sous-jacentes — c'est précisément la valeur d'un outil professionnel. L'ingénieur interprète et décide ; la plateforme calcule et documente.

---

### D — Procès-verbal scellé

À l'issue d'un calcul, le BE peut émettre un PV. Ce document est scellé : un mécanisme d'intégrité (sceau HMAC + horodatage serveur) garantit que le contenu n'a pas été modifié après émission. Le sceau est vérifiable à tout moment.

**Point d'honnêteté assumé :** ce sceau garantit l'intégrité du document — il certifie que le fichier n'a pas été altéré. Ce n'est pas une signature électronique qualifiée au sens de la loi 2008-08. L'opposabilité juridique renforcée (certification PSCe, horodatage qualifié) est prévue en Phase 2. Nous préférons nommer la limite clairement plutôt que de la découvrir au mauvais moment.

**Valeur actuelle :** le BE peut déjà remettre à son maître d'ouvrage un document traçable — daté, numéroté, dont l'intégrité est vérifiable. C'est un niveau de sérieux que peu d'outils concurrents proposent à ce stade.

---

### E — Packs et contrôle d'accès par abonnement

La plateforme sait quels modules un tenant a souscrit. Un BE sans le pack fondations n'accède pas aux moteurs fondations. Cette logique est portée côté serveur — elle n'est pas contournable par manipulation de l'interface.

**Valeur pour STARFIRE :** vous pouvez vendre des packs différenciés (chaussées seul, fondations, plateforme complète) avec la certitude que l'accès est réellement contrôlé. La facturation manuelle de Phase 1 permet de démarrer des abonnements immédiatement ; la bascule vers le paiement en ligne (Phase 2 — PayDunya) se fera sans changer la logique d'accès.

---

### F — Confidentialité des moteurs par conception

Le choix architectural central est le suivant : les moteurs s'exécutent exclusivement sur le serveur. Ce n'est pas une obfuscation — c'est une barrière structurelle. Des garde-fous techniques en CI vérifient en permanence qu'aucun code moteur ne se retrouve dans le bundle livré au navigateur.

**Point d'honnêteté assumé :** les moteurs fondations et labo sont intégrés et s'exécutent côté serveur. L'affichage de leurs résultats côté client est en cours de finalisation, précisément parce que nous appliquons la même rigueur de filtrage avant d'ouvrir chaque sortie au navigateur. Nous préférons livrer progressivement plutôt que de risquer une exposition involontaire de votre méthode.

---

## 3. PARTAGE DES RESPONSABILITÉS ET ATTENTE DE CO-VALIDATION

### Ce que STARFIRE apporte — et que nous n'avons pas à recréer

- Les moteurs de calcul (algorithmes, formules, normes AGEROUTE, Burmister, EC7, Fascicule 62).
- La vérité de référence : les sorties attendues pour chaque jeu de paramètres d'entrée.
- L'expertise pour juger si un résultat est physiquement cohérent.

### Ce que nous apportons — et dont STARFIRE n'a pas à se préoccuper

- La plateforme web, l'infrastructure, la sécurité, l'isolation multi-tenant.
- L'intégration des moteurs (exécution serveur, filtrage des sorties, scellement).
- La facturation, la gestion des accès, la traçabilité.
- Le maintien et l'évolution du logiciel.

### Ce que nous attendons de STARFIRE aujourd'hui

Une co-validation sur le calcul chaussée : les résultats affichés (NE, épaisseurs, déformations, verdict) correspondent-ils aux sorties de référence de vos moteurs pour les mêmes entrées ? Si un écart apparaît, nous le traitons comme un bug d'intégration — pas une divergence de méthode, puisque le moteur est le vôtre.

Ce processus de co-validation est la garantie contractuelle que la plateforme calcule juste. Elle protège STARFIRE autant que nous.

---

## 4. CONCLUSION ET PROCHAINES ÉTAPES

### Ce qui est livré et co-validable aujourd'hui

Socle multi-tenant, auth/RBAC, calcul chaussée en production, PV scellé, contrôle des packs. La Phase 1 est fonctionnelle pour un usage réel.

### Phase 2 — ce que nous construisons ensuite

| Capacité                                         | Statut Phase 2                           |
| ------------------------------------------------ | ---------------------------------------- |
| Paiement en ligne (PayDunya)                     | Intégration planifiée                    |
| Affichage résultats fondations & labo            | Finalisation filtrage client-safe        |
| Opposabilité juridique renforcée du PV           | Certification PSCe + horodatage qualifié |
| Tableau de bord STARFIRE (consommation, revenus) | Préprod Phase 2                          |

### Prochains jalons concrets

1. **Aujourd'hui** : validation par STARFIRE des résultats de calcul chaussée sur cas-tests de référence.
2. **Sous 5 jours ouvrés** : correction de tout écart identifié et re-présentation si nécessaire.
3. **Bascule Phase 2** : sur accord formel après validation Phase 1, démarrage intégration PayDunya + finalisation affichage fondations.

---

## 5. FAQ ANTICIPÉE

**Q1 — Comment êtes-vous sûrs que nos algorithmes ne peuvent pas être extraits par un utilisateur ?**

L'exécution est intégralement côté serveur : le navigateur reçoit des résultats chiffrés (NE, épaisseurs, verdict), jamais le code ni la logique de calcul. Des vérifications automatisées en intégration continue confirment à chaque mise à jour qu'aucun symbole moteur ne figure dans le bundle livré au navigateur. Ce n'est pas de la confiance — c'est une vérification outillée.

**Q2 — Les données de nos clients BE sont hébergées où ? Hors du Sénégal ?**

L'hébergement actuel est sur Render (Frankfurt, Allemagne). Cela constitue un transfert de données hors Sénégal, soumis à la loi 2008-12 et à la CDP. STARFIRE, en tant que responsable de traitement, devra effectuer la déclaration CDP et documenter la base du transfert avant la mise en production commerciale. Nous traitons ce point comme un jalon de conformité explicite, pas comme un détail. Une migration vers un hébergement plus proche (OVH Dakar ou équivalent) est techniquement possible si STARFIRE le souhaite.

**Q3 — Le PV scellé a-t-il une valeur juridique en cas de litige ?**

Le sceau garantit l'intégrité : on peut prouver que le document n'a pas été modifié après émission. Il ne constitue pas une signature électronique qualifiée au sens de la loi sénégalaise 2008-08, et nous ne le présentons pas comme tel. L'opposabilité renforcée — certification PSCe, horodatage tiers qualifié — est prévue en Phase 2. D'ici là, le PV ROADSEN est un document traçable et vérifiable, ce qui représente déjà une avancée significative par rapport à une note de calcul Excel non horodatée.

**Q4 — Comment fonctionne la tarification des packs ? Peut-on la modifier ?**

La grille actuelle (Socle 650k · Chaussées 250k · Fondations superficielles 300k · Fondations profondes 350k · bundles) est celle du devis DEV-RDS-001. STARFIRE définit la politique tarifaire de ses abonnements BE — nous l'implémentons. La logique d'accès par pack est paramétrée côté serveur ; une évolution tarifaire ne nécessite pas de re-développement, seulement une mise à jour de configuration.

**Q5 — Quand les modules fondations et labo seront-ils visibles pour les utilisateurs finaux ?**

Les moteurs s'exécutent déjà. Ce qui reste en cours, c'est la validation que chaque champ de sortie est client-safe — c'est-à-dire qu'il ne révèle pas d'information sur la méthode interne. Nous finalisons ce filtrage moteur par moteur avant d'ouvrir l'affichage. Délai cible : inclus dans les premiers jalons de Phase 2, calendrier à confirmer avec STARFIRE après validation Phase 1.

**Q6 — On voit que vous utilisez des outils tiers (Render, etc.). Que se passe-t-il si l'un d'eux disparaît ou augmente ses prix ?**

L'architecture est conçue pour être portable : la base de données (PostgreSQL), l'API (NestJS) et le frontend (Next.js) ne sont pas liés à un fournisseur spécifique. Un changement d'hébergeur est une opération d'infrastructure, pas une réécriture. Les données sont sauvegardées avec des objectifs de RPO/RTO définis. Nous documentons ces dépendances clairement plutôt que de les minimiser.

---

_Document rédigé pour usage en séance — à adapter selon le déroulement de la démonstration._
_Toute divergence de résultat de calcul identifiée en séance doit être tracée et traitée comme un bug d'intégration à corriger avant validation._
