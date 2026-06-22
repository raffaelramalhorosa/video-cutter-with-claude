import { Config } from "@remotion/cli/config";

// PNG por frame: preserva o canal alpha (JPEG nao tem transparencia).
// Essencial para o motion design entrar no Premiere com fundo transparente.
Config.setVideoImageFormat("png");
Config.setCodec("prores");
Config.setProResProfile("4444");
