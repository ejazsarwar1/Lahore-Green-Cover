// =====================================================================
//  LAHORE LAND BUDGET v8 - SCRIPT C: BUILD (run once, saves assets)
//
//  Splits every pixel of Lahore district into six land classes so the
//  whole district adds up to 100 %:
//    1 trees   2 grass, lawns, parks   3 cropland   4 built-up (grey)
//    5 bare ground (cleared plots, kilns, riverbed)   6 water
//
//  WHAT IS NEW COMPARED WITH v7
//   * Crops are recognised by their growing calendar: six two-month
//     greenness composites per year (wheat peaks Feb-Mar, rice Aug-Sep,
//     fields are bare in May-Jun and Nov), not by three seasons only.
//   * Sentinel-1 radar (sees through winter haze; separates buildings from
//     bare soil; flooded rice paddies are dark in Jul-Aug).
//   * Google Open Buildings presence and Dynamic World probabilities are
//     used as INPUTS to the classifier, not copied as the answer.
//   * One classifier for all six classes. Training labels come from places
//     where independent maps agree (ESA WorldCover 2020 and 2021, Dynamic
//     World, OpenStreetMap parks, JRC water); 30 % is held out for testing.
//
//  Script B combines these class probabilities with its tested tree and
//  grass fractions: trees and grass keep their shares of each pixel and the
//  rest of the pixel is shared among crops, built-up, bare and water.
//
//  HOW TO RUN
//   STEP = 1 -> Run -> Tasks: RUN 'lahore_v8_lc_samples'. Wait until it finishes.
//   STEP = 2 -> Run -> the Console shows accuracy on the held-out 30 %;
//               Tasks: RUN each 'lahore_v8_lc_YYYY'.
// =====================================================================
(function () {

// ---------------------------------------------------------------------
// 1. SETTINGS
// ---------------------------------------------------------------------
var ASSET_FOLDER = 'projects/lahore-green-cover-2000-2026/assets/';
var STEP = 1;
var YEARS_TO_BUILD = [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
var TRAIN_YEAR = 2021;      // ESA WorldCover 2021 matches this year
var OSM_ASSET = ASSET_FOLDER + 'lahore_osm_green';
var BUILDINGS_ID = 'GOOGLE/Research/open-buildings-temporal/v1';
var BUILDINGS_LAST = 2023;  // later years use the 2023 buildings layer
var CITY_CENTRE = [74.33, 31.55];
// two-month windows (day of year); the monsoon window often has gaps, which are filled from the year
var WINDOWS = [
  {d0: 1, d1: 59, tag: 'jf'},      // Jan-Feb: wheat growing
  {d0: 60, d1: 120, tag: 'ma'},    // Mar-Apr: wheat peak, then harvest
  {d0: 121, d1: 181, tag: 'mj'},   // May-Jun: fields bare between seasons
  {d0: 182, d1: 243, tag: 'ja'},   // Jul-Aug: rice transplanted, monsoon
  {d0: 244, d1: 304, tag: 'so'},   // Sep-Oct: rice peak, then harvest
  {d0: 305, d1: 366, tag: 'nd'}    // Nov-Dec: fields bare, wheat sown
];
var CS_MIN = 0.6, AOT_MAX = 0.8;
var CLASS_NAMES = ['trees', 'grass', 'crops', 'built', 'bare', 'water'];
var CLASS_POINTS = [1200, 1200, 1500, 1500, 800, 400];
var BOUNDARY_ASSET = '';

// ---------------------------------------------------------------------
// 2. DATA AND FEATURES
// ---------------------------------------------------------------------
var lahore = BOUNDARY_ASSET ? ee.FeatureCollection(BOUNDARY_ASSET) :
  ee.FeatureCollection('WM/geoLab/geoBoundaries/600/ADM2')
    .filter(ee.Filter.eq('shapeGroup', 'PAK'))
    .filter(ee.Filter.stringContains('shapeName', 'ahore'));
var geom = lahore.geometry();
var WC2021 = ee.Image('ESA/WorldCover/v200/2021').select('Map');
var WC2020 = ee.Image('ESA/WorldCover/v100/2020').select('Map');
var JRC = ee.Image('JRC/GSW1_4/GlobalSurfaceWater').select('occurrence').unmask(0);

var BANDS = ['B2', 'B3', 'B4', 'B8', 'B11', 'B12'];
var CSP = ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED');
function s2col(y, d0, d1) {
  var col = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(geom)
    .filterDate(ee.Date.fromYMD(y, 1, 1), ee.Date.fromYMD(y + 1, 1, 1));
  if (d0 !== undefined) col = col.filter(ee.Filter.calendarRange(d0, d1, 'day_of_year'));
  return col.linkCollection(CSP, ['cs_cdf'])
    .map(function (img) {
      var ok = img.select('cs_cdf').gte(CS_MIN).and(img.select('AOT').multiply(0.001).lte(AOT_MAX));
      var sr = img.select(BANDS).multiply(0.0001);
      return sr.addBands(sr.normalizedDifference(['B8', 'B4']).rename('NDVI'))
        .updateMask(ok).copyProperties(img, ['system:time_start']);
    });
}
function ifAny(col, img, empty) { return ee.Image(ee.Algorithms.If(col.size().gt(0), img, empty)); }

var DW_BANDS = ['water', 'trees', 'grass', 'flooded_vegetation', 'crops',
                'shrub_and_scrub', 'built', 'bare', 'snow_and_ice'];
function dwMean(y) {
  return ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1').filterBounds(geom)
    .filterDate(ee.Date.fromYMD(y, 1, 1), ee.Date.fromYMD(y + 1, 1, 1)).select(DW_BANDS).mean();
}
function s1(y, d0, d1) {
  var col = ee.ImageCollection('COPERNICUS/S1_GRD').filterBounds(geom)
    .filterDate(ee.Date.fromYMD(y, 1, 1), ee.Date.fromYMD(y + 1, 1, 1))
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
    .select(['VV', 'VH']);
  if (d0 !== undefined) col = col.filter(ee.Filter.calendarRange(d0, d1, 'day_of_year'));
  return col;
}
function buildings(y) {
  var yy = Math.min(Math.max(y, 2016), BUILDINGS_LAST);
  return ee.ImageCollection(BUILDINGS_ID).filterBounds(geom)
    .filterDate(ee.Date.fromYMD(yy, 1, 1), ee.Date.fromYMD(yy + 1, 1, 1))
    .select('building_presence').mosaic().unmask(0);
}
var lonlat = ee.Image.pixelLonLat();
var dcore = lonlat.select('longitude').subtract(CITY_CENTRE[0]).multiply(94.9).pow(2)
  .add(lonlat.select('latitude').subtract(CITY_CENTRE[1]).multiply(110.6).pow(2)).sqrt().rename('dcore');

var FEATURE_NAMES = WINDOWS.map(function (w) { return 'ndvi_' + w.tag; })
  .concat(BANDS.map(function (b) { return b + '_med'; }))
  .concat(['rabi', 'kharif', 'gap', 'amp', 'ndbi', 'mndwi', 'bsi',
           'vv', 'vh', 'vh_ja', 'vv_sd', 'bpres', 'bdens',
           'dw_crops', 'dw_built', 'dw_bare', 'dw_water', 'dw_trees', 'dw_grass', 'dcore']);

var F = {};
function features(y) {
  if (F[y]) return F[y];
  var year = s2col(y);
  var med = ifAny(year, year.median(), ee.Image.constant([0, 0, 0, 0, 0, 0, 0])
    .rename(BANDS.concat(['NDVI'])).updateMask(0));
  // two-month greenness, gaps filled with the year's median greenness
  var nd = WINDOWS.map(function (w) {
    var c = s2col(y, w.d0, w.d1);
    return ifAny(c, c.select('NDVI').median(), med.select('NDVI'))
      .unmask(med.select('NDVI')).rename('ndvi_' + w.tag);
  });
  var rabi = nd[0].max(nd[1]).rename('rabi');            // winter (wheat) season peak
  var kharif = nd[3].max(nd[4]).rename('kharif');        // summer (rice) season peak
  var gap = nd[2].min(nd[5]).rename('gap');              // between-season low
  var amp = ee.Image.cat(nd).reduce(ee.Reducer.max()).subtract(ee.Image.cat(nd).reduce(ee.Reducer.min()))
    .rename('amp');
  var ndbi = med.normalizedDifference(['B11', 'B8']).rename('ndbi');
  var mndwi = med.normalizedDifference(['B3', 'B11']).rename('mndwi');
  var bsi = med.expression('((s + r) - (n + b)) / ((s + r) + (n + b))',
    {s: med.select('B11'), r: med.select('B4'), n: med.select('B8'), b: med.select('B2')}).rename('bsi');
  var radar = s1(y), radarJA = s1(y, 182, 243);
  var noRadar = ee.Image.constant([0, 0]).rename(['VV', 'VH']).updateMask(0);
  var sar = ifAny(radar, radar.median(), noRadar).focalMedian(15, 'circle', 'meters');
  var sarSd = ifAny(radar, radar.select('VV').reduce(ee.Reducer.stdDev()), noRadar.select('VV')).rename('vv_sd');
  var vhJA = ifAny(radarJA, radarJA.select('VH').median(), noRadar.select('VH'))
    .focalMedian(15, 'circle', 'meters').rename('vh_ja');
  var dw = dwMean(y);
  var bpres = buildings(y).focalMean(10, 'square', 'meters').rename('bpres');
  F[y] = ee.Image.cat(nd).addBands(med.select(BANDS).rename(BANDS.map(function (b) { return b + '_med'; })))
    .addBands(ee.Image.cat([rabi, kharif, gap, amp, ndbi, mndwi, bsi,
      sar.select('VV').rename('vv'), sar.select('VH').rename('vh'), vhJA, sarSd, bpres,
      dw.select('built').focalMean(500, 'circle', 'meters').rename('bdens'),
      dw.select('crops').rename('dw_crops'), dw.select('built').rename('dw_built'),
      dw.select('bare').rename('dw_bare'), dw.select('water').rename('dw_water'),
      dw.select('trees').rename('dw_trees'), dw.select('grass').rename('dw_grass'), dcore]))
    .select(FEATURE_NAMES).clip(geom);
  return F[y];
}

// ---------------------------------------------------------------------
// 3. STEP 1: training labels where independent maps agree
// ---------------------------------------------------------------------
if (STEP === 1) {
  var fT = features(TRAIN_YEAR);
  var dw = dwMean(TRAIN_YEAR);
  var osm = ee.FeatureCollection(OSM_ASSET).randomColumn('r', 7);
  var osmGrass = osm.filter(ee.Filter.inList('category', ['park', 'grass', 'golf', 'shrub']));
  var osmAll = ee.Image().byte().paint(osm, 1).unmask(0);
  var osmGrassImg = ee.Image().byte().paint(osmGrass, 1).unmask(0);
  var bp = buildings(TRAIN_YEAR);
  var cls = ee.Image(0)
    .where(WC2020.eq(10).and(WC2021.eq(10)).and(dw.select('trees').gte(0.5)), 1)
    .where(osmGrassImg.eq(1).and(dw.select('trees').lt(0.4)).and(fT.select('gap').gte(0.25)), 2)
    .where(WC2020.eq(40).and(WC2021.eq(40)).and(dw.select('crops').gte(0.5)).and(osmAll.eq(0))
      .and(fT.select('amp').gte(0.2)), 3)
    .where(WC2020.eq(50).and(WC2021.eq(50)).and(dw.select('built').gte(0.5)).and(osmAll.eq(0)), 4)
    .where(WC2021.eq(60).and(dw.select('bare').gte(0.4)).and(bp.lt(0.3)), 5)
    .where(WC2021.eq(80).and(dw.select('water').gte(0.5)).and(JRC.gte(75)), 6)
    .rename('cls').selfMask().clip(geom);
  var samples = cls.addBands(fT).stratifiedSample({numPoints: 500, classBand: 'cls', region: geom,
    scale: 10, seed: 81, geometries: true, tileScale: 16, dropNulls: true,
    classValues: [1, 2, 3, 4, 5, 6], classPoints: CLASS_POINTS})
    .randomColumn('split', 82);
  Export.table.toAsset({collection: samples, description: 'lahore_v8_lc_samples',
    assetId: ASSET_FOLDER + 'lahore_v8_lc_samples'});
  print('STEP 1: RUN lahore_v8_lc_samples in the Tasks tab, wait for it to finish, then set STEP = 2.');
}

// ---------------------------------------------------------------------
// 4. STEP 2: accuracy on the held-out 30 %, then one asset per year
// ---------------------------------------------------------------------
// Bands (Int16): p_trees, p_grass, p_crops, p_built, p_bare, p_water (probability x1000),
//  lc (most likely class 1-6), croptype (0 none, 1 winter only, 2 summer only, 3 both seasons),
//  rabi, kharif, gap (greenness x10000)
if (STEP === 2) {
  var tab = ee.FeatureCollection(ASSET_FOLDER + 'lahore_v8_lc_samples');
  var train = tab.filter(ee.Filter.lt('split', 0.7)), test = tab.filter(ee.Filter.gte('split', 0.7));
  var rf = ee.Classifier.smileRandomForest({numberOfTrees: 200, seed: 83})
    .train({features: train, classProperty: 'cls', inputProperties: FEATURE_NAMES});
  var cm = test.classify(rf).errorMatrix('cls', 'classification', [1, 2, 3, 4, 5, 6]);
  ee.Dictionary({oa: cm.accuracy(), kappa: cm.kappa(), ua: cm.consumersAccuracy(), pa: cm.producersAccuracy(),
    m: cm.array(), n: test.size(), imp: ee.Dictionary(rf.explain()).get('importance')})
    .evaluate(function (r, err) {
      if (err) { print('Accuracy check failed: ' + err); return; }
      var lines = ['HELD-OUT ACCURACY (' + r.n + ' points): overall ' + (100 * r.oa).toFixed(1) + '%, kappa ' +
        r.kappa.toFixed(2)];
      CLASS_NAMES.forEach(function (c, i) {
        lines.push('  ' + c + ': user’s ' + (100 * r.ua[0][i]).toFixed(0) + '%, producer’s ' +
          (100 * r.pa[i][0]).toFixed(0) + '%');
      });
      lines.push('Confusion matrix (rows = label, columns = map, order ' + CLASS_NAMES.join(', ') + '):');
      r.m.forEach(function (row, i) { lines.push('  ' + CLASS_NAMES[i] + ': ' + row.join(' ')); });
      var imp = Object.keys(r.imp).sort(function (a, b) { return r.imp[b] - r.imp[a]; }).slice(0, 10);
      lines.push('Most useful inputs: ' + imp.join(', '));
      print('LANDBUDGET_ACCURACY\n' + lines.join('\n'));
    });

  var rfProb = rf.setOutputMode('MULTIPROBABILITY');
  YEARS_TO_BUILD.forEach(function (y) {
    var f = features(y);
    var p = f.classify(rfProb).arrayFlatten([CLASS_NAMES.map(function (c) { return 'p_' + c; })]);
    var lc = p.toArray().arrayArgmax().arrayGet(0).add(1).rename('lc');
    // crop calendar: green (>= 0.45) in the winter season, the summer season, or both
    var w = f.select('rabi').gte(0.45), s = f.select('kharif').gte(0.45);
    var croptype = ee.Image(0).where(w.and(s.not()), 1).where(s.and(w.not()), 2).where(w.and(s), 3)
      .updateMask(lc.eq(3)).unmask(0).rename('croptype');
    var out = ee.Image.cat([p.multiply(1000), lc, croptype,
      f.select(['rabi', 'kharif', 'gap']).multiply(10000)]).toInt16().clip(geom).set('year', y);
    Export.image.toAsset({image: out, description: 'lahore_v8_lc_' + y,
      assetId: ASSET_FOLDER + 'lahore_v8_lc_' + y, region: geom, scale: 10, maxPixels: 1e11,
      pyramidingPolicy: {'.default': 'mean', 'lc': 'mode', 'croptype': 'mode'}});
  });
  print('STEP 2: ' + YEARS_TO_BUILD.length + ' tasks created. RUN each one in the Tasks tab. ' +
    'Copy the LANDBUDGET_ACCURACY block when it appears and send it to Claude.');
}

})();
