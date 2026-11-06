"""Book registry: every book the tail. NFL pipeline requests from Action Network (standard library only; imported by
auto/fetch_an.py, src/slate.py, src/export_overlay.py and src/board.py).

  name   canonical name used in slate offers / best (the 5 original names are unchanged)
  code   short code used by the board (DK, FD, MGM, BR, CZR unchanged)
  kind   sportsbook | exchange | pickem    (pickem books are line-only: never used for edge, p, best, break-even, interval or Kelly)
  url    New Jersey site (the app links to it; the user bets from NJ)

Caesars: Action Network book 123 is primary, 49 (the id the pipeline used through week 9) is the fallback. A prop never
carries both: 49 is dropped wherever 123 posted a usable offer for the same market and player.
"""
CONSENSUS, OPEN = 15, 30
CZR_PRIMARY, CZR_FALLBACK = 123, 49

#            an_id  name          code     kind          url (NJ)
_REG = [(68,   'DraftKings', 'DK',    'sportsbook', 'https://sportsbook.draftkings.com'),
        (69,   'FanDuel',    'FD',    'sportsbook', 'https://sportsbook.fanduel.com'),
        (75,   'BetMGM',     'MGM',   'sportsbook', 'https://sports.nj.betmgm.com'),
        (123,  'Caesars',    'CZR',   'sportsbook', 'https://sportsbook.caesars.com/us/nj/bet'),
        (49,   'Caesars',    'CZR',   'sportsbook', 'https://sportsbook.caesars.com/us/nj/bet'),
        (71,   'BetRivers',  'BR',    'sportsbook', 'https://nj.betrivers.com'),
        (79,   'bet365',     'B365',  'sportsbook', 'https://www.nj.bet365.com'),
        (2988, 'Fanatics',   'FAN',   'sportsbook', 'https://sportsbook.fanatics.com'),
        (2724, 'Hard Rock',  'HR',    'sportsbook', 'https://app.hardrock.bet'),
        (1929, 'BetParx',    'PARX',  'sportsbook', 'https://nj.betparx.com'),
        (4620, 'theScore',   'SCORE', 'sportsbook', 'https://thescore.bet'),
        (5203, 'Polymarket', 'POLY',  'exchange',   'https://polymarket.com'),
        (5204, 'Novig',      'NOVIG', 'exchange',   'https://novig.us'),
        (4727, 'Kalshi',     'KAL',   'exchange',   'https://kalshi.com'),
        (2194, 'PrizePicks', 'PP',    'pickem',     'https://app.prizepicks.com'),
        (3348, 'Underdog',   'UD',    'pickem',     'https://underdogfantasy.com'),
        (3612, 'Sleeper',    'SLP',   'pickem',     'https://sleeper.com')]

NAME = {b: n for b, n, _, _, _ in _REG}
CODE = {b: c for b, _, c, _, _ in _REG}
KIND = {b: k for b, _, _, k, _ in _REG}
ORDER = list(dict.fromkeys(n for _, n, _, _, _ in _REG))          # display order, one entry per canonical name
INFO = {n: dict(code=c, kind=k, url=u, an_id=b) for b, n, c, k, u in reversed(_REG)}   # reversed: Caesars keeps 123 as an_id
INFO['Caesars']['an_id_fallback'] = CZR_FALLBACK
# every id requested from Action Network: consensus, opener, then the books
REQUEST = [CONSENSUS, OPEN] + [b for b, *_ in _REG]
REQUEST_IDS = ','.join(str(b) for b in REQUEST)

# book sets `best` may choose from (the 3% MIN_EDGE gate was validated on CORE5 prices: 2026 weeks 1-8 priced backtest)
CORE5 = ('DraftKings', 'FanDuel', 'BetMGM', 'BetRivers', 'Caesars')
CORE7 = CORE5 + ('bet365', 'Fanatics')
PRICED = tuple(n for n in ORDER if INFO[n]['kind'] != 'pickem')   # every sportsbook and exchange with two-sided prices
SETS = dict(core5=CORE5, core7=CORE7, all=PRICED)


def no_price(o): return o is None or o != o or o == 0


def is_pickem(book_id, *odds):
    """Line-only pick'em: a pick'em book, or a book whose posted odds are all missing / 0."""
    if KIND.get(int(book_id)) == 'pickem': return True
    return all(no_price(o) for o in odds)


def drop_fallback(ids):
    """Caesars dedupe for one market of one player (board): 49 only when 123 is absent."""
    ids = set(ids)
    return ids - {CZR_FALLBACK} if CZR_PRIMARY in ids else ids
