# VeloFit iPad - version PWA v16

Cette version est une application complémentaire pour iPad. Elle n'utilise pas `main.py`/`.kv`, car ces fichiers sont propres à Kivy sur PC. L'équivalent iPad est :

- `index.html` : interface
- `style.css` : style visuel proche de la version PC
- `app.js` : logique caméra, vidéo, MediaPipe et calcul d'angle

## Changements v16

- Interface rapprochée de la version PC Kivy.
- Choix caméra limité à :
  - `0 - arrière`
  - `1 - avant`
- Sélection vidéo séparée du lancement :
  1. cliquer sur `Choisir vidéo`
  2. choisir une vidéo
  3. cliquer sur `Lancer vidéo sélectionnée`
- Fonction miroir supprimée.
- MediaPipe plus proche de la version PC : uniquement les points HANCHE / GENOU / CHEVILLE, les lignes et l'angle. Les petits points bleus de debug ont été retirés.
- Stabilisation ajoutée : modèle MediaPipe `full`, détection limitée à environ 14 FPS, lissage des points et de l'angle.

## Test local sur Mac

Dans ce dossier :

```bash
python3 -m http.server 8000
```

Puis ouvrir sur le Mac :

```text
http://localhost:8000
```

## Test sur iPad

Pour que la caméra fonctionne sur iPad, il faut idéalement héberger le dossier en HTTPS, par exemple avec GitHub Pages.

Ensuite ouvrir l'adresse HTTPS dans Safari, puis utiliser :

- `Lancer caméra` pour la caméra arrière ou avant selon le choix `Caméra`.
- `Choisir vidéo`, puis `Lancer vidéo sélectionnée` pour analyser une vidéo.

## Conseils pour que MediaPipe soit plus stable

- Filmer le cycliste de côté.
- Garder hanche, genou et cheville visibles dans l'image.
- Mettre l'iPad en paysage.
- Éviter les vêtements trop larges et les arrière-plans très chargés.
- Utiliser une bonne lumière.
- Si la vidéo ne se lance pas, essayer une vidéo `.mp4` ou `.mov` stockée localement sur l'iPad.
