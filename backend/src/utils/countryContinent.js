// Maps a country name (as returned by Nominatim's reverse/forward geocoding
// address.country field) to one of the six continent buckets risk_zones.continent
// is CHECK-constrained to: africa, asia, europe, americas, mideast, oceania.
// "mideast" splits out of geographic Asia because that's how the rest of this
// app already buckets zones (see the seed data and ContinentBar.tsx).
const COUNTRY_TO_CONTINENT = {
  // Africa
  'Algeria': 'africa', 'Angola': 'africa', 'Benin': 'africa', 'Botswana': 'africa',
  'Burkina Faso': 'africa', 'Burundi': 'africa', 'Cameroon': 'africa', 'Cape Verde': 'africa',
  'Central African Republic': 'africa', 'Chad': 'africa', 'Comoros': 'africa',
  'Democratic Republic of the Congo': 'africa', 'Republic of the Congo': 'africa',
  "Côte d'Ivoire": 'africa', 'Ivory Coast': 'africa', 'Djibouti': 'africa', 'Egypt': 'africa',
  'Equatorial Guinea': 'africa', 'Eritrea': 'africa', 'Eswatini': 'africa', 'Ethiopia': 'africa',
  'Gabon': 'africa', 'Gambia': 'africa', 'Ghana': 'africa', 'Guinea': 'africa',
  'Guinea-Bissau': 'africa', 'Kenya': 'africa', 'Lesotho': 'africa', 'Liberia': 'africa',
  'Libya': 'africa', 'Madagascar': 'africa', 'Malawi': 'africa', 'Mali': 'africa',
  'Mauritania': 'africa', 'Mauritius': 'africa', 'Morocco': 'africa', 'Mozambique': 'africa',
  'Namibia': 'africa', 'Niger': 'africa', 'Nigeria': 'africa', 'Rwanda': 'africa',
  'Senegal': 'africa', 'Seychelles': 'africa', 'Sierra Leone': 'africa', 'Somalia': 'africa',
  'South Africa': 'africa', 'South Sudan': 'africa', 'Sudan': 'africa', 'Tanzania': 'africa',
  'Togo': 'africa', 'Tunisia': 'africa', 'Uganda': 'africa', 'Zambia': 'africa', 'Zimbabwe': 'africa',
  'Western Sahara': 'africa',

  // Middle East
  'Yemen': 'mideast', 'Syria': 'mideast', 'Lebanon': 'mideast', 'Iraq': 'mideast',
  'Iran': 'mideast', 'Israel': 'mideast', 'Palestine': 'mideast', 'State of Palestine': 'mideast',
  'Jordan': 'mideast', 'Saudi Arabia': 'mideast', 'Kuwait': 'mideast', 'Bahrain': 'mideast',
  'Qatar': 'mideast', 'United Arab Emirates': 'mideast', 'Oman': 'mideast', 'Turkey': 'mideast',
  'Türkiye': 'mideast',

  // Asia
  'Afghanistan': 'asia', 'Bangladesh': 'asia', 'Bhutan': 'asia', 'Brunei': 'asia',
  'Cambodia': 'asia', 'China': 'asia', 'India': 'asia', 'Indonesia': 'asia', 'Japan': 'asia',
  'Kazakhstan': 'asia', 'Kyrgyzstan': 'asia', 'Laos': 'asia', 'Malaysia': 'asia',
  'Maldives': 'asia', 'Mongolia': 'asia', 'Myanmar': 'asia', 'Burma': 'asia', 'Nepal': 'asia',
  'North Korea': 'asia', 'Pakistan': 'asia', 'Papua New Guinea': 'oceania', 'Philippines': 'asia',
  'Singapore': 'asia', 'South Korea': 'asia', 'Sri Lanka': 'asia', 'Taiwan': 'asia',
  'Tajikistan': 'asia', 'Thailand': 'asia', 'Timor-Leste': 'asia', 'Turkmenistan': 'asia',
  'Uzbekistan': 'asia', 'Vietnam': 'asia',

  // Europe
  'Albania': 'europe', 'Andorra': 'europe', 'Armenia': 'europe', 'Austria': 'europe',
  'Azerbaijan': 'europe', 'Belarus': 'europe', 'Belgium': 'europe', 'Bosnia and Herzegovina': 'europe',
  'Bulgaria': 'europe', 'Croatia': 'europe', 'Cyprus': 'europe', 'Czechia': 'europe',
  'Czech Republic': 'europe', 'Denmark': 'europe', 'Estonia': 'europe', 'Finland': 'europe',
  'France': 'europe', 'Georgia': 'europe', 'Germany': 'europe', 'Greece': 'europe',
  'Hungary': 'europe', 'Iceland': 'europe', 'Ireland': 'europe', 'Italy': 'europe',
  'Kosovo': 'europe', 'Latvia': 'europe', 'Liechtenstein': 'europe', 'Lithuania': 'europe',
  'Luxembourg': 'europe', 'Malta': 'europe', 'Moldova': 'europe', 'Monaco': 'europe',
  'Montenegro': 'europe', 'Netherlands': 'europe', 'North Macedonia': 'europe', 'Norway': 'europe',
  'Poland': 'europe', 'Portugal': 'europe', 'Romania': 'europe', 'Russia': 'europe',
  'San Marino': 'europe', 'Serbia': 'europe', 'Slovakia': 'europe', 'Slovenia': 'europe',
  'Spain': 'europe', 'Sweden': 'europe', 'Switzerland': 'europe', 'Ukraine': 'europe',
  'United Kingdom': 'europe', 'Vatican City': 'europe',

  // Americas
  'Argentina': 'americas', 'Bahamas': 'americas', 'Barbados': 'americas', 'Belize': 'americas',
  'Bolivia': 'americas', 'Brazil': 'americas', 'Canada': 'americas', 'Chile': 'americas',
  'Colombia': 'americas', 'Costa Rica': 'americas', 'Cuba': 'americas', 'Dominica': 'americas',
  'Dominican Republic': 'americas', 'Ecuador': 'americas', 'El Salvador': 'americas',
  'Grenada': 'americas', 'Guatemala': 'americas', 'Guyana': 'americas', 'Haiti': 'americas',
  'Honduras': 'americas', 'Jamaica': 'americas', 'Mexico': 'americas', 'Nicaragua': 'americas',
  'Panama': 'americas', 'Paraguay': 'americas', 'Peru': 'americas', 'Saint Lucia': 'americas',
  'Suriname': 'americas', 'Trinidad and Tobago': 'americas', 'United States': 'americas',
  'United States of America': 'americas', 'Uruguay': 'americas', 'Venezuela': 'americas',

  // Oceania
  'Australia': 'oceania', 'Fiji': 'oceania', 'Kiribati': 'oceania', 'Marshall Islands': 'oceania',
  'Micronesia': 'oceania', 'Nauru': 'oceania', 'New Zealand': 'oceania', 'Palau': 'oceania',
  'Samoa': 'oceania', 'Solomon Islands': 'oceania', 'Tonga': 'oceania', 'Tuvalu': 'oceania',
  'Vanuatu': 'oceania',
};

function continentForCountry(countryName) {
  if (!countryName) return null;
  return COUNTRY_TO_CONTINENT[countryName.trim()] || null;
}

module.exports = { COUNTRY_TO_CONTINENT, continentForCountry };
