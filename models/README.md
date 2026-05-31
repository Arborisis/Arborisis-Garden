# Modèles ONNX de détection de maladies

Le classifieur CNN de maladies ([lib/ml/diseaseClassifier.ts](../lib/ml/diseaseClassifier.ts))
est **optionnel et désactivé par défaut**. Sans modèle configuré, l'app reste pleinement
fonctionnelle (analyse couleur locale + LLM). Le fichier `.onnx` n'est **pas versionné**
(trop volumineux, voir `.gitignore`).

## Modèle recommandé : MobileNetV2 PlantVillage (38 classes)

Source : [`linkanjarad/mobilenet_v2_1.0_224-plant-disease-identification`](https://huggingface.co/linkanjarad/mobilenet_v2_1.0_224-plant-disease-identification)
(fine-tuné sur le PlantVillage Kaggle, 38 classes). Son **ordre de classes est identique**
à celui de [lib/ml/diseaseLabels.ts](../lib/ml/diseaseLabels.ts), donc les labels FR par défaut
correspondent aux index de sortie — aucune surcharge `PLANT_DISEASE_LABELS` nécessaire.

### 1. Générer le `.onnx`

```bash
pip install "transformers>=4.40,<5" torch onnx
python3 scripts/convert-plant-disease-model.py
# -> models/plant-disease-mobilenetv2.onnx (~9 Mo)
```

### 2a. Usage local (dev)

```bash
PLANT_DISEASE_MODEL_PATH="./models/plant-disease-mobilenetv2.onnx"
PLANT_DISEASE_NORMALIZE="minus1_1"
PLANT_DISEASE_INPUT_SIZE="224"
```

### 2b. Production (Railway, bucket S3 privé — recommandé)

Le bucket Railway est privé. On charge donc le modèle via le **client S3 authentifié**
(pas un `fetch` HTTP) en donnant la clé de l'objet :

```bash
PLANT_DISEASE_MODEL_BUCKET_KEY="models/plant-disease-mobilenetv2.onnx"
PLANT_DISEASE_MODEL_DIR="/data/models"   # volume persistant -> pas de re-téléchargement par déploiement
PLANT_DISEASE_NORMALIZE="minus1_1"
```

Upload de l'objet dans le bucket (depuis le repo, credentials injectés par Railway) :

```bash
railway run -- node --import tsx scripts/upload-model-to-bucket.ts
```

Le modèle est téléchargé une fois depuis le bucket puis mis en cache localement.
(`PLANT_DISEASE_MODEL_URL` reste possible pour un stockage HTTP public.)

## Réglages de prétraitement

| Variable | MobileNetV2 (ci-dessus) | Notes |
|---|---|---|
| `PLANT_DISEASE_INPUT_SIZE` | `224` | côté de l'image carrée |
| `PLANT_DISEASE_NORMALIZE` | `minus1_1` | `imagenet` \| `0_1` \| `minus1_1` selon le modèle |
| `PLANT_DISEASE_LAYOUT` | `nchw` | `nchw` \| `nhwc` |
| `PLANT_DISEASE_APPLY_SOFTMAX` | `1` | `1` si le modèle sort des logits, `0` si déjà des probabilités |

Pour un autre modèle, adaptez ces variables et — si l'ordre des classes diffère —
fournissez `PLANT_DISEASE_LABELS` (JSON) ou `PLANT_DISEASE_LABELS_PATH`.
