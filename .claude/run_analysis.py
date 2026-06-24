"""
Dispara 'claude -p' para analisar a transcrição e gravar output/analise.json.
Chamado pelo monitor em background — retorna imediatamente (Popen, sem esperar).
"""
import subprocess
import os

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROMPT_FILE = os.path.join(PROJECT, ".claude", "analyze_transcript_prompt.md")

with open(PROMPT_FILE, "r", encoding="utf-8") as f:
    prompt = f.read()

subprocess.Popen(
    ["claude", "-p", "--permission-mode", "acceptEdits",
     "--allowedTools", "Read,Write", prompt],
    cwd=PROJECT,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)
