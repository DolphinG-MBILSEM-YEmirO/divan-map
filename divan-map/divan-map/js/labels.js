/**
 * Turkish UI labels and symbol metadata shared by the map, the panel and the legend.
 * Colour is never the only carrier of meaning: each category also has a letter
 * glyph and each location type has its own marker shape.
 */

export const CATEGORY_META = {
  place: { label: 'Tarihî yer adları', singular: 'Yer adı', glyph: 'Y', cssVar: '--c-place' },
  group: { label: 'Türk boyları ve topluluklar', singular: 'Boy / topluluk', glyph: 'T', cssVar: '--c-group' },
  geography: { label: 'Dağ, akarsu, göl ve denizler', singular: 'Coğrafi unsur', glyph: 'C', cssVar: '--c-geography' },
  route: { label: 'Ticaret ve göç yolları', singular: 'Güzergâh', glyph: 'G', cssVar: '--c-route' },
};

export const LOCATION_TYPE_META = {
  precise: {
    label: 'Kesin konum',
    shape: 'dairesel, dolu simge',
    help: 'Konum, kaynaklarca yeterince açık biçimde belirlenmiştir.',
  },
  approximate: {
    label: 'Yaklaşık konum',
    shape: 'kesikli kenarlı daire ve yarı saydam alan',
    help: 'Konum yaklaşıktır. Gerçek yer, gösterilen alanın içinde herhangi bir yerde olabilir.',
  },
  disputed: {
    label: 'Tartışmalı konum',
    shape: 'elmas simge ve noktalı alan',
    help: 'Araştırmacılar konum konusunda farklı görüşlere sahiptir.',
  },
  schematic: {
    label: 'Özgün haritadaki şematik konum',
    shape: 'kare simge',
    help: 'Yerin özgün haritada çizildiği yeri gösterir. Modern anlamda koordinat değildir.',
  },
};

export const CONFIDENCE_META = {
  high: { label: 'Yüksek güven', help: 'Birden çok güvenilir kaynak bilgiyi destekliyor.' },
  medium: { label: 'Orta güven', help: 'Bilgi kaynaklarca destekleniyor ancak ayrıntıda belirsizlik var.' },
  low: { label: 'Düşük güven', help: 'Kaynaklar bilgiyi zayıf destekliyor. Kesin bilgi gibi okunmamalıdır.' },
  demo: { label: 'Örnek içerik', help: 'Arayüzü göstermek için eklenmiş örnek kayıt. Gerçek veri değildir.' },
};

export const FEATURE_TYPE_LABELS = {
  mountain: 'Dağ',
  river: 'Akarsu',
  lake: 'Göl',
  sea: 'Deniz',
  desert: 'Çöl',
  other: 'Diğer',
};

export const SOURCE_GROUP_LABELS = {
  work: 'Eser ve neşirler',
  study: 'Araştırma ve incelemeler',
  software: 'Yazılım ve harita altlığı',
};

/** Status of a modern-equivalent entry: how well the consulted sources agree. */
export const EQUIVALENT_STATUS = {
  agreed: { label: 'Kaynaklar aynı karşılığı veriyor', symbol: '●' },
  single: { label: 'Tek kaynakta bulundu', symbol: '▲' },
  tentative: { label: 'Olası (kaynak temkinli)', symbol: '◇' },
  disputed: { label: 'Tartışmalı veya farklı', symbol: '◆' },
  unidentified: { label: 'Belirlenemedi', symbol: '○' },
};
