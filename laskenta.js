// Perintöagentin laskentatyökalu (sama logiikka kuin laskenta.py).
(function (root) {
  const ASTEIKOT = {
    "2026": {
      I:  [[30000, 100, 7], [40000, 800, 10], [60000, 2800, 13], [200000, 21000, 16], [1000000, 149000, 19]],
      II: [[30000, 100, 19], [40000, 2000, 25], [60000, 7000, 29], [200000, 47600, 31], [1000000, 295600, 33]]
    },
    "2017": {
      I:  [[20000, 100, 7], [40000, 1500, 10], [60000, 3500, 13], [200000, 21700, 16], [1000000, 149700, 19]],
      II: [[20000, 100, 19], [40000, 3900, 25], [60000, 8900, 29], [200000, 49500, 31], [1000000, 297500, 33]]
    }
  };
  const PUOLISOVAHENNYS = 90000, ALAIKAISYYSVAHENNYS = 60000;
  const I_LUOKKA = new Set(["lapsi", "lapsenlapsi", "puoliso", "avopuoliso_I", "puolison_lapsi", "vanhempi", "isovanhempi"]);
  const r2 = x => Math.round(x * 100) / 100;
  const f2 = x => x.toFixed(2);

  class Juristille extends Error {}

  function asteikkoVuodelle(v) {
    if (v >= 2026) return "2026";
    if (v >= 2017) return "2017";
    throw new Juristille("Kuolinvuosi ennen 2017: asteikko ei ole työkalussa.");
  }

  function perintovero(verotettava, luokka, asteikko) {
    const rivit = ASTEIKOT[asteikko][luokka];
    if (verotettava < rivit[0][0]) return 0;
    let rivi = rivit[0];
    for (const r of rivit) if (verotettava >= r[0]) rivi = r;
    return r2(rivi[1] + (verotettava - rivi[0]) * rivi[2] / 100);
  }

  function ositus(t) {
    const v = t.vainaja;
    const vu = v.varat_ulkop || 0;
    if (!t.naimisissa) {
      return [Math.max(v.varat_avio + vu - v.velat, 0), 0, ["Vainaja ei ollut naimisissa, ositusta ei tehdä."]];
    }
    const l = t.leski || {};
    const avioehto = t.avioehto || "ei";
    const sel = [];
    if (avioehto === "taydellinen") {
      sel.push("Avioehto sulkee avio-oikeuden kokonaan, joten tasinkoa ei makseta (osituslaskelma ilman tasinkoa).");
      return [Math.max(v.varat_avio + vu - v.velat, 0), 0, sel];
    }
    if (avioehto !== "ei") throw new Juristille("Avioehto ei ole vakiotyyppiä.");
    const vN = Math.max(v.varat_avio - v.velat, 0);
    const lN = Math.max((l.varat_avio || 0) - (l.velat || 0), 0);
    const puolikas = (vN + lN) / 2;
    sel.push(`Avio-oikeuden alainen netto: vainaja ${f2(vN)}, leski ${f2(lN)}. Kummallekin kuuluu ${f2(puolikas)}.`);
    let tasinko;
    if (vN >= lN) {
      tasinko = vN - puolikas;
      sel.push(`Vainajan pesä maksaa leskelle tasinkoa ${f2(tasinko)}.`);
    } else {
      const tl = lN - puolikas;
      if (t.leski_tasinkoprivilegi) {
        tasinko = 0;
        sel.push(`Leski vetoaa AL 103 § 2 momenttiin eikä maksa tasinkoa (${f2(tl)} jää maksamatta).`);
      } else {
        tasinko = -tl;
        sel.push(`Leski maksaa vainajan pesälle tasinkoa ${f2(tl)}.`);
      }
    }
    return [Math.max(vN - tasinko + vu, 0), tasinko, sel];
  }

  function lakimaaraiset(t) {
    const lapset = t.lapset || [];
    const p = {};
    if (lapset.length) {
      const n = lapset.length;
      for (const lapsi of lapset) {
        if (lapsi.elossa !== false) {
          p[lapsi.nimi] = { osa: 1 / n, suhde: "lapsi", ika: lapsi.ika ?? 99, lahin: true };
        } else {
          const j = lapsi.jalkelaiset || [];
          if (!j.length) throw new Juristille(`Kuollut lapsi ${lapsi.nimi} ilman jälkeläisiä: tarkista osakkaat.`);
          for (const x of j) p[x.nimi] = { osa: 1 / n / j.length, suhde: "lapsenlapsi", ika: x.ika ?? 99, lahin: true };
        }
      }
      return p;
    }
    if (t.naimisissa) {
      p[(t.leski && t.leski.nimi) || "Leski"] = { osa: 1, suhde: "puoliso", ika: 99, lahin: true };
      return p;
    }
    throw new Juristille("Ei rintaperillisiä eikä leskeä: perimys vanhemmille tai sisaruksille ei ole työkalussa.");
  }

  function laske(t) {
    const out = { selitys: [], juristille: [] };
    try {
      const asteikko = asteikkoVuodelle(t.kuolinvuosi);
      out.selitys.push(`Asteikko: perittävä kuollut ${t.kuolinvuosi}, sovelletaan asteikkoa '${asteikko}'.`);
      const [pesa, tasinko, sel] = ositus(t);
      out.selitys.push(...sel);
      out.tasinko_leskelle = r2(tasinko);
      out.selitys.push(`Perinnönjaossa jaettava pesä ${f2(pesa)}.`);

      const per = lakimaaraiset(t);
      const ennakot = t.ennakkoperinnot || {};
      const ek = n => ennakot[n] || 0;
      const nimet = Object.keys(per);
      const lask = pesa + nimet.reduce((s, n) => s + ek(n), 0);
      let saajat = {};
      for (const n of nimet) saajat[n] = lask * per[n].osa - ek(n);
      if (Object.values(saajat).some(v => v < 0)) {
        out.selitys.push("Ennakkoperintö ylittää osuuden: saaja ei palauta, muiden osuudet lasketaan uudelleen.");
        out.juristille.push("Ylisuuri ennakkoperintö: sen huomioon ottaminen saajan perintöverotuksessa (PerVL 16 §) on tarkistettava.");
        const yli = nimet.filter(n => saajat[n] < 0);
        const muut = nimet.filter(n => !yli.includes(n));
        const summa = muut.reduce((s, n) => s + per[n].osa, 0);
        const lask2 = pesa + muut.reduce((s, n) => s + ek(n), 0);
        saajat = {};
        for (const n of yli) saajat[n] = 0;
        for (const n of muut) saajat[n] = lask2 * per[n].osa / summa - ek(n);
      }
      const lakimaar = { ...saajat };

      const testamentit = t.testamentit || [];
      const tiedot = {};
      for (const n of nimet) tiedot[n] = { suhde: per[n].suhde, ika: per[n].ika, lahin: per[n].lahin };
      let jaljella = pesa;
      const lisat = {};
      for (const ts of testamentit) {
        if (ts.tyyppi === "legaatti" || ts.tyyppi === "omistusoikeus") {
          const maara = ts.tyyppi === "legaatti" ? ts.summa : ts.osuus * pesa;
          lisat[ts.saaja] = (lisat[ts.saaja] || 0) + maara;
          jaljella -= maara;
          if (!tiedot[ts.saaja]) tiedot[ts.saaja] = { suhde: ts.suhde, ika: ts.ika ?? 99, lahin: false };
        } else if (ts.tyyppi === "hallintaoikeus_leskelle") {
          out.juristille.push("Leskellä hallintaoikeustestamentti: omistusoikeuden saajien verosta tehdään hallintaoikeusvähennys, jota työkalu ei laske. Todellinen vero on pienempi.");
        } else {
          throw new Juristille("Testamentti ei ole vakiotyyppiä.");
        }
      }
      if (jaljella < -0.01) throw new Juristille("Testamenttimääräykset ylittävät pesän.");

      let jako;
      if (testamentit.some(ts => ts.tyyppi === "legaatti" || ts.tyyppi === "omistusoikeus")) {
        jako = {};
        for (const n of Object.keys(lakimaar)) jako[n] = pesa ? Math.max(jaljella, 0) * lakimaar[n] / pesa : 0;
        for (const n of Object.keys(jako)) {
          if (!["lapsi", "lapsenlapsi"].includes(per[n].suhde)) continue;
          const lakiosa = lakimaar[n] / 2;
          if (jako[n] < lakiosa - 0.01) {
            if ((t.lakiosaa_vaativat || []).includes(n)) {
              const vaje = lakiosa - jako[n];
              jako[n] = lakiosa;
              const tl = Object.values(lisat).reduce((a, b) => a + b, 0);
              for (const s of Object.keys(lisat)) lisat[s] -= vaje * lisat[s] / tl;
              out.selitys.push(`${n} vaatii lakiosaa ${f2(lakiosa)}; testamenttisaajien osuuksia vähennetään ${f2(vaje)}.`);
            } else {
              out.selitys.push(`${n} saisi lakiosana ${f2(lakiosa)}, mutta ei ole vaatinut sitä.`);
            }
          }
        }
        for (const [s, m] of Object.entries(lisat)) jako[s] = (jako[s] || 0) + m;
      } else {
        jako = lakimaar;
      }

      const tulos = {};
      for (const [n, osuus] of Object.entries(jako)) {
        const ti = tiedot[n];
        const luokka = I_LUOKKA.has(ti.suhde) ? "I" : "II";
        const ennakko = ek(n);
        let vah = 0;
        if (ti.suhde === "puoliso" || ti.suhde === "avopuoliso_I") vah += PUOLISOVAHENNYS;
        if ((ti.suhde === "lapsi" || ti.suhde === "lapsenlapsi") && ti.ika < 18 && ti.lahin) vah += ALAIKAISYYSVAHENNYS;
        const lahjat3v = (t.muut_lahjat_3v || {})[n] || 0;
        const verotettava = Math.floor(Math.max(osuus + ennakko + lahjat3v - vah, 0) / 100) * 100; // PerVL 16 § ja 31 § 3 mom
        let vero = perintovero(verotettava, luokka, asteikko);
        vero = Math.max(r2(vero - ((t.maksettu_lahjavero || {})[n] || 0)), 0);
        tulos[n] = { saa_jaossa: r2(osuus), ennakkoperinto: ennakko, lahjat_3v: lahjat3v, veroluokka: luokka, vahennykset: vah,
                     verotettava: r2(verotettava), perintovero: vero };
      }
      out.perilliset = tulos;
      return out;
    } catch (e) {
      if (e instanceof Juristille) return { virhe: "juristille: " + e.message, selitys: out.selitys };
      return { virhe: "Syötevirhe: " + e.message + ". Tarkista tapauksen rakenne." };
    }
  }

  root.Perintolaskenta = { laske, perintovero };
  if (typeof module !== "undefined") module.exports = root.Perintolaskenta;
})(typeof window !== "undefined" ? window : globalThis);
