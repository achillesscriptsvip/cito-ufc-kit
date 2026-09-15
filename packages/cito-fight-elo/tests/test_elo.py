"""Tests for the Fight-Elo engine.

Everything here runs on synthetic bouts with known properties, so the tests
verify behaviour rather than snapshot whatever the live data happens to be.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from cito_fight_elo import BoutResult, FightElo, Prediction, from_dataset


def bout(a, b, winner, day=1, method="Decision - Unanimous", round_=3, month=1):
    return BoutResult(
        fighter_a=a,
        fighter_b=b,
        winner=winner,
        event_date=date(2026, month, day),
        method=method,
        round=round_,
    )


# --------------------------------------------------------------------------- #
# rating basics
# --------------------------------------------------------------------------- #


def test_new_fighters_start_at_the_default():
    assert FightElo().rating("nobody") == 1500.0


def test_winner_gains_and_loser_loses():
    elo = FightElo().fit([bout("a", "b", "a")])
    assert elo.rating("a") > 1500.0
    assert elo.rating("b") < 1500.0


def test_ratings_are_zero_sum_for_equal_k():
    elo = FightElo().fit([bout("a", "b", "a")])
    gained = elo.rating("a") - 1500.0
    lost = 1500.0 - elo.rating("b")
    assert gained == pytest.approx(lost, abs=1e-9)


def test_records_are_tracked():
    elo = FightElo().fit([bout("a", "b", "a"), bout("a", "c", "c", day=2)])
    assert elo.record("a") == (1, 1)
    assert elo.record("b") == (0, 1)
    assert elo.record("c") == (1, 0)


def test_a_draw_registers_activity_without_deciding():
    elo = FightElo().fit([bout("a", "b", None, method="Draw")])
    assert elo.bouts["a"] == 1
    assert elo.bouts["b"] == 1
    assert elo.rating("a") == pytest.approx(1500.0)
    assert elo.rating("b") == pytest.approx(1500.0)


def test_self_bout_is_ignored():
    elo = FightElo().fit([bout("a", "a", "a")])
    assert elo.rating("a") == 1500.0


# --------------------------------------------------------------------------- #
# probability
# --------------------------------------------------------------------------- #


def test_equal_ratings_are_a_coin_flip():
    p = FightElo().predict("a", "b")
    assert p.p_a == pytest.approx(0.5)
    assert p.p_b == pytest.approx(0.5)
    assert p.confidence == pytest.approx(0.0)


def test_four_hundred_point_gap_is_about_ten_to_one():
    elo = FightElo()
    elo.ratings["strong"] = 1900.0
    elo.ratings["weak"] = 1500.0
    p = elo.predict("strong", "weak")
    assert p.p_a == pytest.approx(10 / 11, abs=1e-6)
    assert p.favourite == "strong"
    assert p.confidence == pytest.approx(0.818181, abs=1e-5)


def test_probabilities_sum_to_one():
    elo = FightElo()
    elo.ratings.update({"a": 1620.0, "b": 1487.0})
    p = elo.predict("a", "b")
    assert p.p_a + p.p_b == pytest.approx(1.0)


def test_unknown_fighters_are_reported_as_such():
    p = FightElo().predict("debutant-a", "debutant-b")
    assert p.bouts_a == 0 and p.bouts_b == 0
    assert p.p_a == pytest.approx(0.5)


# --------------------------------------------------------------------------- #
# margin of victory
# --------------------------------------------------------------------------- #


def test_a_finish_moves_ratings_more_than_a_split_decision():
    finish = FightElo().fit([bout("a", "b", "a", method="KO/TKO", round_=1)])
    split = FightElo().fit([bout("a", "b", "a", method="Decision - Split")])
    assert finish.rating("a") > split.rating("a")


def test_no_contest_does_not_move_ratings():
    elo = FightElo().fit([bout("a", "b", "a", method="No Contest")])
    assert elo.rating("a") == pytest.approx(1500.0)


def test_unknown_method_falls_back_to_neutral_weight():
    elo = FightElo()
    assert elo._fresh() is not elo  # sanity: fresh() builds a new engine
    model = FightElo().fit([bout("a", "b", "a", method="Some New Method")])
    assert model.rating("a") > 1500.0


# --------------------------------------------------------------------------- #
# time decay
# --------------------------------------------------------------------------- #


def test_recent_results_outweigh_old_ones():
    """A fighter whose win is recent should end higher than one whose win is old."""
    old = BoutResult("a", "b", "a", date(2020, 1, 1), "KO/TKO")
    new = BoutResult("c", "d", "c", date(2026, 1, 1), "KO/TKO")
    elo = FightElo().fit([old, new], decay_from=date(2026, 1, 1))
    assert elo.rating("c") > elo.rating("a")


def test_zero_halflife_disables_decay():
    elo = FightElo(halflife_days=0)
    assert elo._decay(date(2000, 1, 1), date(2026, 1, 1)) == 1.0


# --------------------------------------------------------------------------- #
# k damping
# --------------------------------------------------------------------------- #


def test_provisional_setting_amplifies_early_career_updates():
    """A new fighter converges faster when provisional_bouts is on.

    The point is to establish a rating quickly from a small sample, not to hold
    it back — a debutant has no information, so movement is a feature.
    """
    plain = FightElo().fit([bout("a", "b", "a")])
    provisional = FightElo(provisional_bouts=10).fit([bout("a", "b", "a")])
    assert abs(provisional.rating("a") - 1500.0) > abs(plain.rating("a") - 1500.0)


def test_damping_starts_high_and_settles_at_k():
    """K ramps from 2x at debut down to 1x at the provisional threshold."""
    elo = FightElo(provisional_bouts=10)
    assert elo._k_for("debutant") == pytest.approx(elo.k * 2.0)
    elo.bouts["halfway"] = 5
    assert elo._k_for("halfway") == pytest.approx(elo.k * 1.5)
    elo.bouts["veteran"] = 10
    assert elo._k_for("veteran") == pytest.approx(elo.k)


def test_damping_disabled_when_threshold_is_zero():
    elo = FightElo(provisional_bouts=0)
    assert elo._k_for("anyone") == elo.k


# --------------------------------------------------------------------------- #
# ordering and fitting
# --------------------------------------------------------------------------- #


def test_fit_is_chronological_regardless_of_input_order():
    early = BoutResult("a", "b", "b", date(2026, 1, 1))
    late = BoutResult("a", "b", "a", date(2026, 6, 1))
    shuffled = FightElo().fit([late, early])
    ordered = FightElo().fit([early, late])
    assert shuffled.rating("a") == pytest.approx(ordered.rating("a"))
    assert shuffled.rating("b") == pytest.approx(ordered.rating("b"))


def test_undated_bouts_are_still_applied():
    elo = FightElo().fit([bout("a", "b", "a"), BoutResult("c", "d", "c")])
    assert elo.bouts["c"] == 1


def test_leaderboard_respects_min_bouts_and_order():
    bouts = [
        bout("a", "x", "a"),
        bout("a", "y", "a", day=2),
        bout("b", "z", "b"),
    ]
    elo = FightElo().fit(bouts)
    top = elo.leaderboard(limit=5, min_bouts=2)
    assert [t[0] for t in top] == ["a"]
    assert elo.leaderboard(limit=5, min_bouts=1)[0][1] >= elo.leaderboard(limit=5, min_bouts=1)[1][1]


# --------------------------------------------------------------------------- #
# backtest
# --------------------------------------------------------------------------- #


def _synthetic_season(n=120, noise=0):
    """A season where 'strong' usually wins.

    ``noise`` injects upsets so accuracy is not a trivial 100%: with noise=0 the
    data is deterministic and any model that learns "strong wins" scores
    perfectly, which tells us nothing about leakage.
    """
    bouts = []
    for i in range(n):
        d = date(2026, 1, 1) + timedelta(days=i)
        upset = noise and (i % noise == 0)
        if i % 3 == 0:
            winner = f"mid{i}" if upset else "strong"
            bouts.append(BoutResult("strong", f"mid{i}", winner, d, "KO/TKO"))
        else:
            winner = f"mid{i+1}" if upset else f"mid{i}"
            bouts.append(BoutResult(f"mid{i}", f"mid{i+1}", winner, d, "Decision - Unanimous"))
    return bouts


def test_backtest_reports_a_result():
    bt = FightElo().backtest(_synthetic_season(), folds=3, min_train=30)
    assert bt.n > 0
    assert 0.0 <= bt.accuracy <= 1.0
    assert 0.0 <= bt.brier <= 1.0
    assert bt.log_loss > 0.0
    assert len(bt.fold_accuracy) >= 1
    assert "accuracy" in bt.summary()


def test_backtest_learns_a_dominant_fighter():
    bt = FightElo().backtest(_synthetic_season(180), folds=3, min_train=40)
    assert bt.accuracy > 0.5


def test_backtest_requires_enough_data():
    with pytest.raises(ValueError, match="need at least"):
        FightElo().backtest([bout("a", "b", "a")], min_train=50)


def test_backtest_does_not_leak_the_future():
    """Accuracy must be imperfect on noisy data, and each fold must be scored
    by a model fitted only on the past."""
    bouts = _synthetic_season(180, noise=5)
    bt = FightElo().backtest(bouts, folds=3, min_train=40)
    assert bt.n > 0
    assert 0.0 < bt.accuracy < 1.0
    assert len(bt.fold_accuracy) == 3


# --------------------------------------------------------------------------- #
# tuning
# --------------------------------------------------------------------------- #


def test_tune_returns_sorted_candidates():
    results = FightElo().tune(_synthetic_season(140), k_values=[16, 32], halflives=[365, 100000])
    assert results
    losses = [r[3] for r in results]
    assert losses == sorted(losses)


# --------------------------------------------------------------------------- #
# parsing
# --------------------------------------------------------------------------- #


def test_from_dict_reads_snake_case():
    b = BoutResult.from_dict(
        {
            "fighter_slug": "a",
            "opponent_slug": "b",
            "winner_slug": "a",
            "event_date": "2026-08-15",
            "result": "Submission",
            "result_round": 2,
        }
    )
    assert (b.fighter_a, b.fighter_b, b.winner) == ("a", "b", "a")
    assert b.event_date == date(2026, 8, 15)
    assert b.round == 2


def test_from_dict_reads_camel_case():
    b = BoutResult.from_dict(
        {
            "fighter_a": "a",
            "fighter_b": "b",
            "winnerFighterSlug": "b",
            "startsAt": "2026-08-16T01:00:00.000Z",
            "method": "KO/TKO",
            "resultRound": 1,
        }
    )
    assert b.winner == "b"
    assert b.event_date == date(2026, 8, 16)


def test_from_dict_reads_api_corners_array():
    b = BoutResult.from_dict(
        {
            "winnerFighterSlug": "a",
            "method": "Decision - Unanimous",
            "fighters": [
                {"corner": "red", "fighterSlug": "a"},
                {"corner": "blue", "fighterSlug": "b"},
            ],
        }
    )
    assert b.fighter_a == "a" and b.fighter_b == "b"
    assert b.decided


def test_from_dict_marks_draws():
    b = BoutResult.from_dict({"fighter_a": "a", "fighter_b": "b", "method": "Draw"})
    assert b.is_draw
    assert not b.decided


def test_from_dataset_dedupes_bout_rows(tmp_path):
    p = tmp_path / "bouts.jsonl"
    p.write_text(
        "\n".join(
            [
                '{"bout_id":"1","fighter_slug":"a","opponent_slug":"b","winner_slug":"a","event_date":"2026-01-01","result":"KO/TKO"}',
                '{"bout_id":"1","fighter_slug":"b","opponent_slug":"a","winner_slug":"a","event_date":"2026-01-01","result":"KO/TKO"}',
                '{"bout_id":"2","fighter_slug":"c","opponent_slug":"d","winner_slug":"d","event_date":"2026-01-02","result":"SUB"}',
            ]
        ),
        encoding="utf-8",
    )
    bouts = from_dataset(str(p))
    assert len(bouts) == 2
    assert {b.bout_id for b in bouts} == {"1", "2"}


# --------------------------------------------------------------------------- #
# prediction object
# --------------------------------------------------------------------------- #


def test_prediction_str_is_readable():
    p = Prediction("a", "b", 0.7, 0.3, 1600.0, 1500.0)
    text = str(p)
    assert "a" in text and "b" in text
    assert "70.0%" in text
    assert p.favourite == "a"
    assert p.confidence == pytest.approx(0.4)
