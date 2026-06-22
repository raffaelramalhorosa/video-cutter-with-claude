import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from silence_cut import map_time_to_timeline

FPS = 30.0

# Dois trechos mantidos: 0-10s (frames 0-300) e 15-25s (frames 300-600),
# com um corte (silencio removido) entre 10s e 15s.
CLIPS = [
    {"sec_in": 0.0, "sec_out": 10.0, "tl_start": 0, "tl_end": 300},
    {"sec_in": 15.0, "sec_out": 25.0, "tl_start": 300, "tl_end": 600},
]


def test_tempo_dentro_de_trecho_mantido():
    result = map_time_to_timeline(5.0, CLIPS, FPS)
    assert result == {"frame": 150, "anchored": False}


def test_tempo_dentro_de_corte_ancora_na_borda_mais_proxima():
    # 11s esta a 1s do fim do 1o clipe e a 4s do inicio do 2o -> ancora no fim do 1o.
    result = map_time_to_timeline(11.0, CLIPS, FPS)
    assert result == {"frame": 300, "anchored": True}

    # 14s esta a 4s do fim do 1o clipe e a 1s do inicio do 2o -> ancora no inicio do 2o.
    result = map_time_to_timeline(14.0, CLIPS, FPS)
    assert result == {"frame": 300, "anchored": True}


def test_tempo_antes_do_primeiro_clipe():
    result = map_time_to_timeline(-2.0, CLIPS, FPS)
    assert result == {"frame": 0, "anchored": True}


def test_tempo_depois_do_ultimo_clipe():
    result = map_time_to_timeline(99.0, CLIPS, FPS)
    assert result == {"frame": 600, "anchored": True}
