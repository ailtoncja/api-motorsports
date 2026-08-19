// Os sites oficiais do GT World Challenge marcam a nacionalidade de cada
// piloto so com uma classe CSS de bandeira (ex.: "flag size--tiny ned"), sem
// nome nenhum. Os codigos NAO seguem um padrao unico -- confirmado raspando
// paginas reais, o mesmo pais aparece com codigos diferentes em corridas/
// regioes diferentes (ex.: Holanda como "ned" e como "ndl", Dinamarca como
// "den" e como "dnk"). Por isso o mapa cobre variantes conhecidas, e
// codeToCountry() nunca lanca erro pra um codigo desconhecido -- devolve o
// proprio codigo em maiusculas, pra nao travar o sync por causa de um pais
// que ainda nao apareceu numa corrida.
export const COUNTRY_CODE_MAP = {
  arg: 'Argentina',
  aus: 'Austrália',
  aut: 'Áustria',
  bel: 'Bélgica',
  bra: 'Brasil',
  can: 'Canadá',
  chl: 'Chile',
  chn: 'China',
  col: 'Colômbia',
  cze: 'República Tcheca',
  den: 'Dinamarca',
  dnk: 'Dinamarca',
  esp: 'Espanha',
  fin: 'Finlândia',
  fra: 'França',
  gbr: 'Reino Unido',
  ger: 'Alemanha',
  hkg: 'Hong Kong',
  hun: 'Hungria',
  idn: 'Indonésia',
  ind: 'Índia',
  irl: 'Irlanda',
  isr: 'Israel',
  ita: 'Itália',
  jpn: 'Japão',
  kor: 'Coreia do Sul',
  kwt: 'Kuwait',
  lux: 'Luxemburgo',
  mex: 'México',
  mon: 'Mônaco',
  ndl: 'Países Baixos',
  ned: 'Países Baixos',
  nor: 'Noruega',
  nzl: 'Nova Zelândia',
  oma: 'Omã',
  per: 'Peru',
  phi: 'Filipinas',
  pol: 'Polônia',
  por: 'Portugal',
  qat: 'Catar',
  rsa: 'África do Sul',
  sau: 'Arábia Saudita',
  sgp: 'Cingapura',
  slo: 'Eslovênia',
  smr: 'San Marino',
  sui: 'Suíça',
  swe: 'Suécia',
  tha: 'Tailândia',
  tld: 'Tailândia',
  uae: 'Emirados Árabes Unidos',
  ukr: 'Ucrânia',
  usa: 'EUA',
};

export function codeToCountry(code) {
  if (!code) return null;
  const normalized = code.trim().toLowerCase();
  return COUNTRY_CODE_MAP[normalized] ?? normalized.toUpperCase();
}
