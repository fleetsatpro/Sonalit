'use strict';

// Conservative attribution for Sonalit's supported East African reporting set.
// Event country is inferred from story text, never from publisher country or a
// GDELT source-country field. Ambiguous multi-country text stays unscoped.
const ALIASES = {
  KE:['Kenya','Nairobi','Mombasa','Kisumu','Nakuru','Eldoret','Garissa','Mandera','Wajir','Lamu','Turkana','Marsabit','Isiolo','Kilifi','Kwale','Kajiado','Machakos','Makueni','Kitui','Bungoma','Kakamega','Homa Bay','Nyeri','Meru','Kiambu','Kericho','Narok','Bomet','Siaya','Migori','Kisii','Nyamira','Taita Taveta','Laikipia','Nyandarua','Elgeyo Marakwet','West Pokot','Samburu','Baringo','Trans Nzoia','Uasin Gishu','Tharaka Nithi','Murang’a','Muranga','Kirinyaga','Embu','Nandi','Vihiga','Ruiru','Thika'],
  SO:['Somalia','Somaliland','Mogadishu','Kismayo','Baidoa','Beledweyne','Bosaso','Garowe','Galkayo','Hargeisa','Berbera','Las Anod','Marka','Jowhar','Dhusamareb','Puntland'],
  ET:['Ethiopia','Addis Ababa','Amhara','Tigray','Oromia','Afar','Jigjiga','Dire Dawa','Mekelle','Gondar','Bahir Dar','Gambela','Benishangul Gumuz','Sidama','Harar'],
  UG:['Uganda','Kampala','Gulu','Jinja','Mbarara','Kasese','Entebbe','Arua','Soroti','Fort Portal','Hoima','Moroto','Kabale'],
  TZ:['Tanzania','Dar es Salaam','Arusha','Dodoma','Mwanza','Mbeya','Kigoma','Mtwara','Zanzibar','Tanga','Morogoro','Iringa'],
  RW:['Rwanda','Kigali','Rubavu','Ruhengeri','Musanze','Gisenyi','Nyagatare','Huye','Nyamasheke'],
  BI:['Burundi','Bujumbura','Gitega','Rumonge','Ngozi','Bururi'],
  SS:['South Sudan','Juba','Malakal','Bentiu','Bor','Renk','Wau','Yei','Jonglei','Upper Nile','Unity State','Western Equatoria','Rubkona'],
  DJ:['Djibouti','Djibouti City','Tadjourah','Obock','Ali Sabieh','Dikhil','Arta'],
  ER:['Eritrea','Asmara','Massawa','Assab','Keren','Dekemhare','Barentu','Akordat'],
  SD:['Sudan','Khartoum','Darfur','El Fasher','Nyala','Port Sudan','Omdurman','Wad Madani','Kordofan','Dongola','El Obeid','Sennar','Kassala','Geneina'],
  CD:['DR Congo','DRC','Democratic Republic of the Congo','Democratic Republic of Congo','Congo Kinshasa','Congo-Kinshasa','Kinshasa','Goma','Bukavu','Beni','Bunia','Ituri','North Kivu','South Kivu','Uvira','Fizi','Lubumbashi','Kasai','Tanganyika Province']
};

function normalizeGeoText(value) {
  return String(value || '').toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function normalizeCountryCode(value) {
  const raw = normalizeGeoText(value).toUpperCase();
  if (/^[A-Z]{2}$/.test(raw)) return raw;
  for (const [code, aliases] of Object.entries(ALIASES)) {
    if (aliases.some(alias => raw === normalizeGeoText(alias).toUpperCase())) return code;
  }
  return null;
}

function countryCodesInText(value) {
  const text = normalizeGeoText(value);
  if (!text) return [];
  const padded = ' ' + text + ' ';
  const matches = new Set();
  for (const [code, aliases] of Object.entries(ALIASES)) {
    for (const alias of aliases) {
      const token = normalizeGeoText(alias);
      if (token && padded.includes(' ' + token + ' ')) {
        matches.add(code);
        break;
      }
    }
  }
  return Array.from(matches);
}

function inferCountryCodeFromText(value) {
  const matches = countryCodesInText(value);
  return matches.length === 1 ? matches[0] : null;
}

function inferCountryCodeFromItem(item = {}) {
  const explicit = normalizeCountryCode(item.country_code);
  if (explicit) return explicit;
  const headline = countryCodesInText(item.title || item.headline);
  if (headline.length === 1) return headline[0];
  if (headline.length > 1) return null;
  const body = countryCodesInText(item.body || item.description || item.summary);
  return body.length === 1 ? body[0] : null;
}

module.exports = {
  normalizeCountryCode,
  countryCodesInText,
  inferCountryCodeFromText,
  inferCountryCodeFromItem,
};
