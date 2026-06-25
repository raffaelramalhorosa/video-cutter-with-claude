import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils import parse_srt, sec_to_srt, srt_time_to_sec
from compute import subtract_ranges


# ---------------------------------------------------------------------------
# utils.sec_to_srt
# ---------------------------------------------------------------------------

def test_sec_to_srt_zero():
    assert sec_to_srt(0) == "00:00:00,000"


def test_sec_to_srt_milissegundos():
    assert sec_to_srt(1.5) == "00:00:01,500"


def test_sec_to_srt_horas():
    assert sec_to_srt(3661.25) == "01:01:01,250"


def test_sec_to_srt_arredondamento_sem_overflow():
    # 999ms arredondado não deve virar 1000ms
    assert sec_to_srt(0.9994) == "00:00:00,999"


def test_sec_to_srt_negativo_vira_zero():
    assert sec_to_srt(-5) == "00:00:00,000"


# ---------------------------------------------------------------------------
# utils.srt_time_to_sec
# ---------------------------------------------------------------------------

def test_srt_time_to_sec_basico():
    assert srt_time_to_sec("00:00:01,234") == 1.234


def test_srt_time_to_sec_com_horas():
    assert srt_time_to_sec("01:01:01,000") == 3661.0


def test_roundtrip_sec_srt():
    # Converter para SRT e de volta deve preservar o valor (com precisão de ms)
    for t in (0.0, 1.5, 3661.25, 7384.999):
        assert abs(srt_time_to_sec(sec_to_srt(t)) - t) < 0.001


# ---------------------------------------------------------------------------
# utils.parse_srt
# ---------------------------------------------------------------------------

def test_parse_srt_basico():
    conteudo = "1\n00:00:01,000 --> 00:00:03,500\nOlá mundo\n\n"
    with tempfile.NamedTemporaryFile("w", suffix=".srt", delete=False,
                                     encoding="utf-8") as f:
        f.write(conteudo)
        nome = f.name
    try:
        segs = parse_srt(nome)
        assert len(segs) == 1
        assert segs[0]["start"] == 1.0
        assert segs[0]["end"] == 3.5
        assert segs[0]["text"] == "Olá mundo"
    finally:
        os.unlink(nome)


def test_parse_srt_multiplos_blocos():
    conteudo = (
        "1\n00:00:00,000 --> 00:00:01,000\nPrimeiro\n\n"
        "2\n00:00:02,000 --> 00:00:03,000\nSegundo\n\n"
    )
    with tempfile.NamedTemporaryFile("w", suffix=".srt", delete=False,
                                     encoding="utf-8") as f:
        f.write(conteudo)
        nome = f.name
    try:
        segs = parse_srt(nome)
        assert len(segs) == 2
        assert segs[1]["text"] == "Segundo"
    finally:
        os.unlink(nome)


def test_parse_srt_vazio():
    with tempfile.NamedTemporaryFile("w", suffix=".srt", delete=False,
                                     encoding="utf-8") as f:
        f.write("")
        nome = f.name
    try:
        assert parse_srt(nome) == []
    finally:
        os.unlink(nome)


# ---------------------------------------------------------------------------
# compute.subtract_ranges
# ---------------------------------------------------------------------------

def test_subtract_ranges_sem_cortes():
    keeps = [(0.0, 10.0)]
    assert subtract_ranges(keeps, []) == [(0.0, 10.0)]


def test_subtract_ranges_corte_no_meio():
    keeps = [(0.0, 10.0)]
    result = subtract_ranges(keeps, [(4.0, 6.0)])
    assert result == [(0.0, 4.0), (6.0, 10.0)]


def test_subtract_ranges_corte_na_borda():
    keeps = [(0.0, 10.0)]
    result = subtract_ranges(keeps, [(0.0, 3.0)])
    assert result == [(3.0, 10.0)]


def test_subtract_ranges_corte_cobre_tudo():
    keeps = [(0.0, 10.0)]
    result = subtract_ranges(keeps, [(0.0, 10.0)])
    assert result == []


def test_subtract_ranges_multiplos_keeps_e_cortes():
    keeps = [(0.0, 10.0), (20.0, 30.0)]
    result = subtract_ranges(keeps, [(5.0, 7.0), (22.0, 25.0)])
    assert (0.0, 5.0) in result
    assert (7.0, 10.0) in result
    assert (20.0, 22.0) in result
    assert (25.0, 30.0) in result
