#!/usr/bin/env python3
"""Convertit un classifieur de maladies PlantVillage (MobileNetV2 HuggingFace) en ONNX.

Genere `models/plant-disease-mobilenetv2.onnx` (38 classes, entree [1,3,224,224]).
Le modele source `linkanjarad/mobilenet_v2_1.0_224-plant-disease-identification` a
le MEME ordre de classes que `lib/ml/diseaseLabels.ts` (Apple scab -> Healthy Tomato),
donc les labels par defaut de l'app correspondent aux index de sortie.

Pretraitement attendu par ce modele (a refleter dans les variables d'env) :
    PLANT_DISEASE_INPUT_SIZE=224
    PLANT_DISEASE_NORMALIZE=minus1_1   # MobileNetV2: (x/255 - 0.5) / 0.5
    PLANT_DISEASE_LAYOUT=nchw
    PLANT_DISEASE_APPLY_SOFTMAX=1      # le modele sort des logits

Prerequis : pip install "transformers>=4.40,<5" torch onnx
Usage     : python3 scripts/convert-plant-disease-model.py [repo_id] [sortie.onnx]
Ensuite   : heberger le .onnx (ex: Railway Object Storage) et renseigner
            PLANT_DISEASE_MODEL_URL, ou pointer PLANT_DISEASE_MODEL_PATH en local.
"""
import json
import os
import sys

import torch
from transformers import AutoModelForImageClassification, AutoImageProcessor

REPO = sys.argv[1] if len(sys.argv) > 1 else "linkanjarad/mobilenet_v2_1.0_224-plant-disease-identification"
OUT = sys.argv[2] if len(sys.argv) > 2 else "models/plant-disease-mobilenetv2.onnx"


class LogitsOnly(torch.nn.Module):
    """Expose une signature ONNX simple: pixel_values -> logits."""

    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, x):
        return self.model(pixel_values=x).logits


def main():
    os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
    print(f"Chargement {REPO} ...")
    model = AutoModelForImageClassification.from_pretrained(REPO).eval()
    proc = AutoImageProcessor.from_pretrained(REPO)
    print(f"  classes={model.config.num_labels} mean={proc.image_mean} std={proc.image_std}")

    dummy = torch.randn(1, 3, 224, 224)
    torch.onnx.export(
        LogitsOnly(model), dummy, OUT,
        input_names=["input"], output_names=["output"],
        opset_version=13,
        dynamic_axes={"input": {0: "batch"}, "output": {0: "batch"}},
    )
    size_mb = round(os.path.getsize(OUT) / 1e6, 2)
    print(f"ONNX ecrit: {OUT} ({size_mb} MB)")

    labels = [model.config.id2label[i] for i in range(model.config.num_labels)]
    labels_path = os.path.join(os.path.dirname(OUT) or ".", "mobilenetv2-id2label.json")
    json.dump(labels, open(labels_path, "w"), ensure_ascii=False, indent=1)
    print(f"Labels (ordre des index): {labels_path}")
    print(f"  [0]={labels[0]!r}  [37]={labels[-1]!r}")


if __name__ == "__main__":
    main()
