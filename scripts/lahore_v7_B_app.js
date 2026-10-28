// =====================================================================
//  LAHORE GREEN COVER v7 - SCRIPT B: APP (reads saved assets, low cost)
//
//  Run Script A v7 first (STEP 1, then STEP 2).
//  Trees are shown and counted as a FRACTION of each 10 m pixel
//  (a pixel that is 30 % tree counts as 30 m2 of tree cover), so street
//  and garden trees in mixed pixels are included. Grass / lawns / parks
//  come from a classifier trained on OpenStreetMap green spaces.
//  Crops are excluded.
//  v7.5: grass is a SHARE of each pixel (green share from lasting NDVI minus tree share,
//  weighted by 1 - crop probability), so it no longer flips on/off; new independent
//  checks C10 (NASA GEDI laser canopy heights) and C11 (Google Open Buildings).
//  v7.4: the grass cut-off is matched year by year so that land which cannot
//  change keeps the same grass share as in 2020 (removes on/off flicker);
//  trees, grass and total get separate trends.
//  Corrections (v7.3): all tree fractions are counted (a 10 % noise floor
//  was tried and removed real sparse trees); the verdict also reports a
//  tree total bias-corrected with held-out canopy data (check C3);
//  year-to-year drift is measured on half of the land that cannot change
//  and removed (the other half tests it in C5); the grass cut-off is tuned
//  automatically by check C4.
// =====================================================================
(function () {

// ---------------------------------------------------------------------
// 1. SETTINGS
// ---------------------------------------------------------------------
var ASSET_FOLDER = 'projects/lahore-green-cover-2000-2026/assets/';
var OSM_ASSET = ASSET_FOLDER + 'lahore_osm_green';
var ALL_YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
var PROVISIONAL = [2026];
var TRAIN_YEAR = 2020;
var GRASS_CUT = 0.5;        // starting grass probability cut-off
var AUTO_TUNE_GRASS = true; // check C4 replaces GRASS_CUT with its recommended cut
var TREE_SMOOTH = true;     // average tree fraction with the neighbouring years
var TREE_FLOOR = 0;         // tree fractions below this count as 0 (0 = keep all; a 10 % floor removed real sparse trees)
var DRIFT_CORRECT = true;   // remove year-to-year drift measured on land that cannot change
var CAL_YEAR = 2020;        // drift is measured relative to this year (the training year)
var GRASS_QMATCH = true;    // (yes/no grass method only) year-matched cut-off
var GRASS_METHOD = 'fraction'; // 'fraction' = grass as a share of each pixel (default); 'binary' = old yes/no
var GEDI_ID = 'LARSE/GEDI/GEDI02_A_002_MONTHLY';           // NASA GEDI canopy heights (independent)
var BUILDINGS_ID = 'GOOGLE/Research/open-buildings-temporal/v1'; // Google Open Buildings 2.5D Temporal
var BUILDINGS_LAST = 2023;  // last year in the Open Buildings Temporal dataset
var MAX_TREE_UNDER_GRASS = 0.3;
var STAT_SCALE = 30;
var PUBLIC_MODE = true;       // true: 'How We Know' shows the saved results of the last full run (no heavy re-run)
var EXPORT_GRAPHICS = false;   // true: also print GRAPHICS_DATA to the Console for tools/build_visuals.py
var EXPORT_BENCH = false;      // true once: starts two export tasks that make the Benchmarks tab load fast
var MAP_HEIGHT = '500px';
var FOLDER = 'lahore_gee_v7';
var BOUNDARY_ASSET = '';

// ---------------------------------------------------------------------
// 2. BOUNDARY AND REFERENCE LAYERS
// ---------------------------------------------------------------------
var lahore = BOUNDARY_ASSET ? ee.FeatureCollection(BOUNDARY_ASSET) :
  ee.FeatureCollection('WM/geoLab/geoBoundaries/600/ADM2')
    .filter(ee.Filter.eq('shapeGroup', 'PAK'))
    .filter(ee.Filter.stringContains('shapeName', 'ahore'));
var geom = lahore.geometry();
var AREA = ee.Image.pixelArea().divide(1e6);
var worldCover = ee.Image('ESA/WorldCover/v200/2021').select('Map');
var WC2020 = ee.Image('ESA/WorldCover/v100/2020').select('Map');
var PIF = worldCover.eq(50).focalMean(60, 'square', 'meters').gte(0.99);
var outline = lahore.style({color: '000000', width: 2.5, fillColor: '00000000'});
var outsideDim = ee.Image(1).updateMask(ee.Image(1).clip(geom).mask().not());

// Neighbourhoods: named suburbs inside Lahore district from OpenStreetMap, with every DHA phase
// listed separately. A trailing 1 marks the main places drawn as markers on the map.
var PLACES = [
  ['Agrics Town', 74.2244, 31.4416],
  ['Al Noor Town', 74.3577, 31.4772],
  ['Al-Faisal Town', 74.4044, 31.5489],
  ['Ali Town', 74.2460, 31.4632],
  ['Ameen Park', 74.2951, 31.5849],
  ['Anarkali', 74.3074, 31.5679],
  ['Askari X', 74.4171, 31.5354],
  ['Awan Town', 74.2632, 31.5042],
  ['Aziz Bhatti Town', 74.4206, 31.5514],
  ['Azizia Town', 74.2754, 31.4766],
  ['Badami Bagh', 74.3195, 31.6025],
  ['Baghbanpura', 74.3767, 31.5845],
  ['Bagrian', 74.2988, 31.4273],
  ['Bahria Nasheman', 74.4031, 31.3199],
  ['Bahria Town', 74.1800, 31.3650, 1],
  ['Batapur', 74.4914, 31.5965],
  ['Begampura', 74.3617, 31.5808],
  ['Bibi Pak Daman', 74.3382, 31.5647],
  ['Bilal Ganj', 74.3011, 31.5817],
  ['BOR Housing Society', 74.2987, 31.4763],
  ['Canal Gardens', 74.1757, 31.3944],
  ['Cantt', 74.3830, 31.5350, 1],
  ['Cavalry Ground', 74.3679, 31.5013],
  ['CBD Walton', 74.3421, 31.4988],
  ['Chah Miran', 74.3430, 31.5869],
  ['China Scheme', 74.3632, 31.5964],
  ['Chung', 74.1743, 31.4326],
  ['DHA Phase 1', 74.4014, 31.4905],
  ['DHA Phase 2', 74.4012, 31.4767],
  ['DHA Phase 3', 74.3723, 31.4740],
  ['DHA Phase 4', 74.3800, 31.4612],
  ['DHA Phase 5', 74.4123, 31.4635],
  ['DHA Phase 6', 74.4382, 31.4671],
  ['DHA Phase 7', 74.4852, 31.4642],
  ['DHA Phase 8', 74.4493, 31.4909],
  ['DHA Phase 9 Prism', 74.3790, 31.4188],
  ['DHA Phase 9 Town', 74.4428, 31.4429],
  ['DHA Phase 10', 74.4142, 31.3315],
  ['DHA Phase 12 (EME)', 74.2142, 31.4476],
  ['Dharampura', 74.3652, 31.5526],
  ['Eden Cottages', 74.3736, 31.4842],
  ['Engineers Town', 74.2967, 31.4120],
  ['Faisal Town', 74.3049, 31.4768],
  ['Faiz Bagh', 74.3362, 31.5830],
  ['Farooq Colony', 74.3675, 31.4787],
  ['Fatehgarh', 74.4060, 31.5724],
  ['Fazaia Housing Scheme', 74.2414, 31.3763],
  ['Gajju Matah', 74.3627, 31.3873],
  ['Garden Town', 74.3248, 31.5017],
  ['Garhi Shahu', 74.3482, 31.5618],
  ['Gawalmandi', 74.3180, 31.5724],
  ['Ghaziabad', 74.3995, 31.5587],
  ['GOR (Officers\' Residences)', 74.3418, 31.5450],
  ['Govt Servants Housing Foundation', 74.1643, 31.4057],
  ['Green Cap Housing Scheme', 74.3559, 31.3981],
  ['Green Town', 74.3075, 31.4321],
  ['Gulberg', 74.3450, 31.5130, 1],
  ['Harbanspura', 74.4450, 31.5700, 1],
  ['Ichhra', 74.3190, 31.5306],
  ['Iqbal Park (Cantt)', 74.3808, 31.4861],
  ['Iqbal Town', 74.2850, 31.5100, 1],
  ['Islamia Park', 74.3048, 31.5494],
  ['Islampura (Krishan Nagar)', 74.2938, 31.5657],
  ['Izmir Town', 74.1770, 31.4111],
  ['Jia Musa', 74.2873, 31.6196],
  ['Johar Town', 74.2720, 31.4680, 1],
  ['Jubilee Town', 74.1839, 31.4182],
  ['Kahna', 74.3700, 31.3700, 1],
  ['Kahna Purana', 74.3726, 31.3523],
  ['Karim Park', 74.2989, 31.5910],
  ['Khayaban-e-Amin', 74.2698, 31.3818],
  ['Kot Khwaja Saeed', 74.3572, 31.5896],
  ['Kot Lakhpat', 74.3383, 31.4664],
  ['Labour Colony', 74.2142, 31.4035],
  ['Lake City', 74.2527, 31.3536],
  ['Lakhoder', 74.4135, 31.6100],
  ['LDA Avenue', 74.2048, 31.4159],
  ['Mall Road (Charing Cross)', 74.3284, 31.5625],
  ['Manawan', 74.4872, 31.5961],
  ['Manga Mandi', 74.0695, 31.2991],
  ['Manhala', 74.5436, 31.5289],
  ['Maraka', 74.1515, 31.3840],
  ['Mayo Gardens', 74.3482, 31.5559],
  ['Mehmood Booti', 74.3950, 31.6049],
  ['Mian Mir', 74.3595, 31.5486],
  ['Misri Shah', 74.3270, 31.5877],
  ['Model Town', 74.3230, 31.4820, 1],
  ['Mozang', 74.3141, 31.5537],
  ['Mughalpura', 74.3786, 31.5649],
  ['Muslim Town', 74.3133, 31.5115],
  ['Mustafa Town', 74.2735, 31.4958],
  ['Mustafabad', 74.4202, 31.2522],
  ['Naulakha', 74.3315, 31.5790],
  ['Nawan Kot', 74.2940, 31.5385],
  ['Naz Town', 74.2654, 31.4028],
  ['NFC Society', 74.2646, 31.4122],
  ['Niaz Baig', 74.2364, 31.4844],
  ['Nishat Colony', 74.3928, 31.4915],
  ['PAEC Housing Society', 74.1603, 31.3822],
  ['PAF Colony', 74.3947, 31.5505],
  ['Pakki Thatti', 74.2966, 31.5299],
  ['Paragon City', 74.4532, 31.5305],
  ['PCSIR Housing Society', 74.2909, 31.4308],
  ['PIA Housing Society', 74.2767, 31.4461],
  ['Qalander Pura', 74.4304, 31.5767],
  ['Qila Gujjar Singh', 74.3294, 31.5693],
  ['Raiwind', 74.2150, 31.2500, 1],
  ['Raj Garh', 74.2969, 31.5560],
  ['Ramgarh', 74.3846, 31.5696],
  ['Rana Town', 74.2842, 31.6368],
  ['Rehman Gardens', 74.4083, 31.4865],
  ['Rehman Pura', 74.3196, 31.5228],
  ['Sabzazar', 74.2701, 31.5218],
  ['Saddar (Cantt)', 74.3802, 31.5500],
  ['Sadhoke', 74.2765, 31.3920],
  ['Samanabad', 74.3017, 31.5395],
  ['Sanda', 74.2884, 31.5582],
  ['Shad Bagh', 74.3380, 31.5995],
  ['Shadman', 74.3270, 31.5402],
  ['Shah Jamal', 74.3275, 31.5283],
  ['Shah Kamal', 74.3057, 31.5270],
  ['Shahdara', 74.2880, 31.6250, 1],
  ['Shalimar', 74.3820, 31.5880, 1],
  ['Sharif Pura', 74.4153, 31.6011],
  ['Sukh Chayn Gardens', 74.1598, 31.3915],
  ['Sunflower Housing Society', 74.2539, 31.4718],
  ['Swami Nagar', 74.3479, 31.5799],
  ['Tariq Garden', 74.2550, 31.4204],
  ['Township', 74.3100, 31.4500, 1],
  ['Upper Mall', 74.3547, 31.5448],
  ['Urdu Bazaar', 74.3096, 31.5750],
  ['Valencia', 74.2583, 31.4067],
  ['Wafaqi Colony', 74.2907, 31.4798],
  ['Wagah', 74.5730, 31.6050, 1],
  ['Wahdat Colony', 74.3074, 31.5165],
  ['Walled City', 74.3150, 31.5820, 1],
  ['Walton', 74.3617, 31.4873],
  ['Wapda Town', 74.2620, 31.4320, 1],
  ['Youhanabad', 74.3666, 31.4134],
  ['Zaman Park', 74.3533, 31.5508]
];

// Villages and hamlets inside Lahore district (OpenStreetMap). Not in the dropdown; they name the
// built-up land outside the city in the Benchmarks tab and in click readouts.
var VILLAGES = [
  ['Ahlu', 74.4055, 31.3841],
  ['Aii Hussain Abad', 74.1446, 31.3849],
  ['Ainu Bhatti', 74.3778, 31.6446],
  ['Al Hamd Farms', 74.5318, 31.5235],
  ['Ali Raza Abad', 74.2311, 31.4330],
  ['Amar Sidhu', 74.3568, 31.4667],
  ['Ameer Pura Juggian', 74.2469, 31.4185],
  ['Amir Pur', 74.2474, 31.4067],
  ['Asal', 74.2056, 31.3565],
  ['Asal Guruke', 74.5362, 31.3927],
  ['Asal Suleman', 74.3563, 31.3203],
  ['Atuasal', 74.4029, 31.3085],
  ['Awan', 74.5290, 31.6096],
  ['Awan Dhaiwala', 74.4620, 31.6490],
  ['Badduke', 74.3709, 31.3182],
  ['Bahler', 74.3970, 31.4106],
  ['Baoowala', 74.4375, 31.5295],
  ['Bara Dari', 74.5768, 31.5595],
  ['Barka Kalan', 74.5267, 31.4632],
  ['Barka Khurd', 74.5330, 31.4762],
  ['Barki', 74.5122, 31.4768],
  ['Bath Kalan', 74.0852, 31.3327],
  ['Bhai Kot', 74.1883, 31.2913],
  ['Bhain Sandhwan', 74.5820, 31.5275],
  ['Bhaini Dhilwan', 74.4800, 31.6733],
  ['Bhaiwala', 74.4947, 31.4919],
  ['Bhaman', 74.5257, 31.5885],
  ['Bhangali', 74.4774, 31.4897],
  ['Bhanu Chak', 74.5698, 31.5972],
  ['Bhasin', 74.5041, 31.6382],
  ['Bhatte Sultanpura', 74.5213, 31.5811],
  ['Bhatti Wal', 74.1927, 31.3928],
  ['Bhobtian', 74.2273, 31.4016],
  ['Bhuler', 74.3794, 31.2919],
  ['Biliana Khu', 74.4332, 31.3495],
  ['Bohgan', 74.4710, 31.3675],
  ['Bole', 74.4462, 31.3564],
  ['Brahmanabad', 74.5256, 31.4468],
  ['Buchoke Manjha', 74.1686, 31.2237],
  ['Budduke', 74.1826, 31.3241],
  ['Bukan Wal', 74.3827, 31.6562],
  ['Burj', 74.5161, 31.3896],
  ['Chachowali', 74.4354, 31.4739],
  ['Chah Timboli', 74.1000, 31.3061],
  ['Chaju Wala', 74.1961, 31.2564],
  ['Chak Buta', 74.3321, 31.3049],
  ['Chamru Pur', 74.2288, 31.3748],
  ['Chandher', 74.5914, 31.5561],
  ['Chandianpind', 74.4261, 31.5602],
  ['Chandiya', 74.3607, 31.3700],
  ['Charr', 74.3842, 31.4754],
  ['Chhankovindi', 74.5389, 31.5033],
  ['Chhapa', 74.5287, 31.5626],
  ['Chimbran Wali Jhuggi', 74.1455, 31.3603],
  ['Chughalpura', 74.4796, 31.5245],
  ['Chung Khurad', 74.4129, 31.4799],
  ['Dayal', 74.5316, 31.6014],
  ['Defense', 74.4666, 31.4683],
  ['Deo Kalan', 74.4161, 31.4203],
  ['Deo Khurd', 74.4156, 31.4066],
  ['Deo Sani', 74.5946, 31.4711],
  ['Dera Chahal', 74.4719, 31.4426],
  ['Dera Gujran', 74.4358, 31.5938],
  ['Dera Mangli', 74.5265, 31.6356],
  ['Dera Peer Mandiana', 74.4972, 31.6531],
  ['Derh Pindi', 74.4261, 31.5281],
  ['Dhalloke', 74.4288, 31.3639],
  ['Dhanova', 74.5436, 31.6277],
  ['Dhira', 74.4821, 31.4758],
  ['Dhirke', 74.5564, 31.4880],
  ['Dhok Manga', 74.1029, 31.2740],
  ['Dhoori', 74.4962, 31.5405],
  ['Dhund', 74.2559, 31.2887],
  ['Dhupsari', 74.1485, 31.3370],
  ['Dograi', 74.4457, 31.5283],
  ['Dograi Kalan', 74.5015, 31.5884],
  ['Dullu', 74.3744, 31.4122],
  ['Dullu Khurd', 74.3634, 31.4065],
  ['Durgpura', 74.4627, 31.5132],
  ['Fateh Abad', 74.2216, 31.4250],
  ['Gaga', 74.5219, 31.4322],
  ['Garad Manhala', 74.5107, 31.5202],
  ['Ghanienke', 74.6085, 31.4625],
  ['Ghankar', 74.3910, 31.3963],
  ['Ghawala Colony', 74.3456, 31.4450],
  ['Ghawind', 74.5716, 31.3901],
  ['Ghawindi', 74.5833, 31.4126],
  ['Ghugian', 74.4654, 31.4807],
  ['Ghurki', 74.6004, 31.4916],
  ['Ghuvindi Khushal Singh', 74.4963, 31.5029],
  ['Gohawa', 74.4278, 31.4928],
  ['Gopal Pura', 74.4594, 31.5966],
  ['Gopal Singhwala', 74.5534, 31.6065],
  ['Gopi Rai', 74.2261, 31.4742],
  ['Gosal Dial', 74.5387, 31.6059],
  ['Gujjar Pura', 74.4243, 31.5444],
  ['Gulshan-e-Yaseen', 74.4606, 31.6087],
  ['Gulwehra', 74.3946, 31.2767],
  ['Gunj Sundwan', 74.4473, 31.6250],
  ['Guru Mangat Nauabad', 74.4113, 31.3922],
  ['Halloki', 74.2832, 31.3716],
  ['Hando Gujjar', 74.4384, 31.6078],
  ['Harnal', 74.4129, 31.3187],
  ['Hasanabad', 74.2346, 31.4424],
  ['Haveli Aslam Wali', 74.2745, 31.2831],
  ['Haveli Baseria Aali', 74.4281, 31.2936],
  ['Haveli Kamlia Wali', 74.5016, 31.3628],
  ['Haveli Tarkhana', 74.3946, 31.3424],
  ['Heir', 74.4894, 31.4099],
  ['Hudiara', 74.5675, 31.4440],
  ['Hussainabad', 74.2212, 31.4337],
  ['Ichogil Hitar', 74.5008, 31.6906],
  ['Ichogil Kalan', 74.5030, 31.6806],
  ['Islam Pura', 74.3338, 31.3775],
  ['Isma\'il Pura', 74.4269, 31.4823],
  ['Jabbo Kalan', 74.3525, 31.6348],
  ['Jahman', 74.5291, 31.3575],
  ['Jalalpur', 74.2377, 31.2575],
  ['Jallo', 74.4928, 31.5762],
  ['Jallo Manhala More', 74.4998, 31.5962],
  ['Jamalpura', 74.2306, 31.2800],
  ['Jandiala', 74.4756, 31.6458],
  ['Janjatey', 74.2429, 31.3607],
  ['Jathol', 74.4023, 31.4378],
  ['Jedu', 74.3145, 31.3459],
  ['Jhalaran', 74.4567, 31.4892],
  ['Jhallian Dhilwan', 74.5665, 31.4744],
  ['Jhuggian', 74.1596, 31.3669],
  ['Jhuggian Arazi', 74.3642, 31.6521],
  ['Jhuggian Bahlu', 74.0610, 31.3495],
  ['Jhuggian Muhammad Bakhsh', 74.5075, 31.5852],
  ['Jhugian Alfa', 74.4396, 31.5039],
  ['Jia Bagga', 74.2907, 31.3294],
  ['Jie ka Tibba', 74.1064, 31.2954],
  ['Jindra Kalan', 74.4555, 31.4944],
  ['Jindri', 74.4560, 31.5056],
  ['Jodhu Dhir', 74.2457, 31.2708],
  ['Julke', 74.3913, 31.3286],
  ['Julliana', 74.1977, 31.3901],
  ['Kacha', 74.3212, 31.3861],
  ['Kalas Mari', 74.4564, 31.5194],
  ['Kamahan', 74.3890, 31.4462],
  ['Kamas', 74.1371, 31.2987],
  ['Kamran Block', 74.2813, 31.5319],
  ['Kang', 74.3184, 31.3298],
  ['Karam Pura', 74.5783, 31.3976],
  ['Karanke', 74.5623, 31.5036],
  ['Karbath', 74.4958, 31.4390],
  ['Karol', 74.3701, 31.6376],
  ['Karyal', 74.2607, 31.3110],
  ['Kashmir Patti', 74.3648, 31.3423],
  ['Katchi Kothi', 74.2441, 31.4512],
  ['Khaira', 74.4979, 31.5844],
  ['Khand', 74.3500, 31.3072],
  ['Khaneki', 74.0675, 31.3676],
  ['Khano Haveli', 74.4265, 31.3063],
  ['Khanpur', 74.2060, 31.4589],
  ['Khara Khu', 74.1816, 31.2617],
  ['Kharak', 74.5993, 31.5672],
  ['Khawaja Faiq', 74.5475, 31.5663],
  ['Khizrabad', 74.1983, 31.4036],
  ['Khokharan Da Warra', 74.0923, 31.4294],
  ['Khudpur', 74.0984, 31.3900],
  ['Khuleke', 74.4406, 31.3620],
  ['Khumbe', 74.2537, 31.4366],
  ['Khurmalian', 74.5912, 31.4835],
  ['Kingra', 74.2674, 31.3081],
  ['Kohrian', 74.5240, 31.4931],
  ['Kot Amir Khan', 74.4122, 31.2938],
  ['Kot Araian', 74.2344, 31.3376],
  ['Kot Bagh', 74.2294, 31.3840],
  ['Kot Channan Din', 74.2451, 31.3648],
  ['Kot Dhani Chand', 74.4423, 31.5884],
  ['Kot Duni Chand', 74.4476, 31.5877],
  ['Kot Islampur', 74.4104, 31.2851],
  ['Kot Jahan Khan', 74.1129, 31.2826],
  ['Kot Kamboh', 74.4764, 31.5918],
  ['Kot Noor Muhammad', 74.2417, 31.3474],
  ['Kot Shah', 74.4654, 31.3618],
  ['Kot Sundar Singh', 74.1394, 31.3394],
  ['Kot Wakilan', 74.5286, 31.3705],
  ['Kotli Abdur Rahman', 74.3896, 31.5782],
  ['Kotli Ghazi', 74.4388, 31.5811],
  ['Ladheke', 74.3198, 31.2779],
  ['Ladheke Neewain', 74.3172, 31.2698],
  ['Lahore Cant', 74.3790, 31.5221],
  ['Lakhan', 74.5126, 31.6075],
  ['Lakhoki', 74.4659, 31.3563],
  ['Laloh', 74.5826, 31.4930],
  ['Laluwal', 74.2634, 31.4447],
  ['Leel', 74.4133, 31.4529],
  ['Lidher', 74.4413, 31.4594],
  ['Lila Pur', 74.5619, 31.5745],
  ['Lodhar Hitha', 74.0898, 31.3460],
  ['Malak Pur', 74.4737, 31.6743],
  ['Malakpur', 74.4324, 31.5166],
  ['Malkhokiw', 74.4532, 31.4051],
  ['Mallian', 74.4641, 31.3886],
  ['Manak', 74.1976, 31.3028],
  ['Mandian Wala', 74.4900, 31.5457],
  ['Manga', 74.0516, 31.3069],
  ['Manhala Valley', 74.5313, 31.5174],
  ['Maral Marri', 74.4469, 31.6397],
  ['Maujoke', 74.5763, 31.5072],
  ['Mehdi Pur', 74.4243, 31.3264],
  ['Mian Singhwala', 74.5003, 31.4868],
  ['Mohlanwal', 74.1406, 31.4082],
  ['Mohlanwal Khurd', 74.1616, 31.4157],
  ['Mota Singhwala', 74.4528, 31.4411],
  ['Mull', 74.1594, 31.3124],
  ['Muridwal', 74.2271, 31.4958],
  ['Musalla Abad', 74.1939, 31.4141],
  ['Nabi Bakshwala', 74.3972, 31.2859],
  ['Nahla', 74.1729, 31.2741],
  ['Nai Abadi', 74.4631, 31.6609],
  ['Nano Dogar', 74.0631, 31.3584],
  ['Narwar', 74.5686, 31.5643],
  ['Nasir Ganj', 74.2008, 31.4248],
  ['Nasirabad', 74.2546, 31.4554],
  ['Natha Singhwala', 74.4306, 31.4581],
  ['Nathoke', 74.5225, 31.5484],
  ['Natt Kalan', 74.4624, 31.6172],
  ['Nawabpura', 74.4452, 31.5774],
  ['Nawan Pind', 74.3467, 31.2945],
  ['Nawan Pind Gujran', 74.5221, 31.5313],
  ['Nawazishabad', 74.2112, 31.4310],
  ['Nurpur', 74.5451, 31.4398],
  ['Padday', 74.5713, 31.5435],
  ['Padhana', 74.6232, 31.4715],
  ['Padri', 74.5015, 31.5132],
  ['Pahat Wali Haveli', 74.5203, 31.3701],
  ['Pajian', 74.2213, 31.3017],
  ['Pandoke', 74.3588, 31.2792],
  ['Pathankey', 74.6234, 31.4356],
  ['PECO Factory', 74.3304, 31.4502],
  ['Phullar Wan', 74.4645, 31.5359],
  ['Pir Mandiala', 74.4913, 31.6537],
  ['Pir Naseer', 74.4320, 31.5604],
  ['Plahre', 74.1194, 31.2887],
  ['Purani Bhaini', 74.1169, 31.4502],
  ['Qila Jiwan Singh', 74.5989, 31.5378],
  ['Qila Lachman Singh', 74.3103, 31.6004],
  ['Qureshi Wala', 74.4325, 31.3959],
  ['Rahimabad', 74.2395, 31.4441],
  ['Rajabole', 74.4088, 31.4001],
  ['Rakh Beknath', 74.5235, 31.3854],
  ['Rakh Bhangali', 74.4824, 31.5138],
  ['Rakh Jehdu', 74.3338, 31.3587],
  ['Rakh Jodhu', 74.2358, 31.2653],
  ['Ramka Khu', 74.1736, 31.3357],
  ['Rampura Kalan', 74.6014, 31.4331],
  ['Rangil Pur', 74.1032, 31.3642],
  ['Rasoolpur', 74.2551, 31.4623],
  ['Rasul Pura', 74.2842, 31.3574],
  ['Roranwala', 74.4355, 31.4478],
  ['Rori', 74.4446, 31.3853],
  ['Royal Villas Scheme', 74.5175, 31.5552],
  ['Sahanke', 74.5862, 31.5717],
  ['Salamatpura', 74.4167, 31.5821],
  ['Samada', 74.0782, 31.3102],
  ['Samsani Khui', 74.2772, 31.4661],
  ['Santpur', 74.5487, 31.6029],
  ['Saora', 74.4371, 31.4131],
  ['Saraich', 74.4388, 31.3164],
  ['Sarja Mirja', 74.6393, 31.4298],
  ['Sehajpal', 74.4343, 31.5057],
  ['Shahdara Bagh', 74.3050, 31.6285],
  ['Shahpur Kanjra', 74.2008, 31.4655],
  ['Shahzad', 74.3957, 31.3569],
  ['Shamkay Bhattian', 74.1050, 31.3313],
  ['Sheikh Kot', 74.1873, 31.3507],
  ['Soiyan Kalan', 74.5557, 31.5033],
  ['Sughra Soomro', 74.6100, 31.4482],
  ['Sultan Colony', 74.4293, 31.4686],
  ['Sultan Pura', 74.3350, 31.2924],
  ['Sultanke', 74.1508, 31.3236],
  ['Sundar', 74.1270, 31.3539],
  ['Taj Garh', 74.4535, 31.6035],
  ['Talib Sarai', 74.1025, 31.2693],
  ['Talwara', 74.4674, 31.6753],
  ['Tanvir Haveli', 74.5138, 31.3666],
  ['Taqipur', 74.5271, 31.5770],
  ['Tarogill', 74.2079, 31.3648],
  ['Thatha Dhilwan', 74.5217, 31.6691],
  ['Thathi Koda', 74.5380, 31.6418],
  ['Thatta', 74.5204, 31.6389],
  ['Thatta Khurd', 74.4256, 31.4086],
  ['Thatta Tarran', 74.5408, 31.6373],
  ['Theh Aso', 74.4323, 31.2696],
  ['Theh Hardat Singh', 74.6164, 31.4281],
  ['Theh Jhamb', 74.4358, 31.2978],
  ['Theh Panju', 74.3497, 31.3671],
  ['Thehpura', 74.6093, 31.5535],
  ['Thela', 74.4488, 31.3944],
  ['Theri', 74.4786, 31.6190],
  ['Thethar', 74.4586, 31.4206],
  ['Tibba', 74.4321, 31.4954],
  ['Tibba Bur Singh', 74.2268, 31.3089],
  ['Tibba Khudpur', 74.1103, 31.3914],
  ['Tirrah', 74.4489, 31.5573],
  ['Tulspura', 74.4591, 31.5800],
  ['Umar Di Jhuggi', 74.1093, 31.4545],
  ['Uppal', 74.6044, 31.4525],
  ['Wahgrian', 74.5009, 31.6301],
  ['Wara Awana', 74.5121, 31.5712],
  ['Wara Gillanwala', 74.0652, 31.2744],
  ['Wara Gujjran', 74.4301, 31.5871],
  ['Wara Khumban Wala', 74.0931, 31.2847],
  ['Wara Moula Wasian', 74.5040, 31.5734],
  ['Wara Siddhu', 74.1852, 31.2764],
  ['Wara Sitar', 74.5082, 31.5670],
  ['Waraich', 74.3125, 31.3711],
  ['Wasoyan', 74.5261, 31.6562],
  ['Watna', 74.2852, 31.2837],
  ['Zahra Pir', 74.4255, 31.6129]
];
var ZONE_PLACES = PLACES.concat(VILLAGES);

var placeDots = ee.FeatureCollection(PLACES.filter(function (p) { return p[3]; }).map(function (p) {
  return ee.Feature(ee.Geometry.Point([p[1], p[2]]), {name: p[0]});
})).style({color: '000000', fillColor: 'ffffff', pointSize: 3, width: 1});
function nearestPlace(lon, lat) {
  var best = null, bestKm = 1e9;
  ZONE_PLACES.forEach(function (p) {
    var dx = (p[1] - lon) * 111.32 * Math.cos(lat * Math.PI / 180);
    var dy = (p[2] - lat) * 110.57;
    var km = Math.sqrt(dx * dx + dy * dy);
    if (km < bestKm) { bestKm = km; best = p[0]; }
  });
  return best + ' (' + bestKm.toFixed(1) + ' km)';
}

// ---------------------------------------------------------------------
// 3. MODEL OUTPUTS FROM THE SAVED ASSETS
// ---------------------------------------------------------------------
var YEARS = ALL_YEARS.slice();
function img(y) { return ee.Image(ASSET_FOLDER + 'lahore_v7_' + y); }
function has(y) { return YEARS.indexOf(y) >= 0; }
function isProvisional(y) { return PROVISIONAL.indexOf(y) >= 0; }
function firstYear() { return YEARS[0]; }
function lastComplete() {
  var c = YEARS.filter(function (y) { return !isProvisional(y); });
  return c[c.length - 1];
}

// --- Drift correction --------------------------------------------------
// Land that cannot change: dense old built-up cores + permanent water.
// It is split into two halves on a ~1 km checkerboard: half A is used to
// MEASURE the drift, half B is kept to TEST it (check C5), so the test is
// not circular.
var PERM_WATER = ee.Image('JRC/GSW1_4/GlobalSurfaceWater').select('occurrence').gte(90).unmask(0);
var INVARIANT = PIF.or(PERM_WATER);
var LL = ee.Image.pixelLonLat();
var CHECKER = LL.select('longitude').multiply(100).floor()
  .add(LL.select('latitude').multiply(100).floor()).mod(2);
var INV_CAL = INVARIANT.and(CHECKER.eq(0));
var INV_TEST = INVARIANT.and(CHECKER.eq(1));
// Offsets are computed ONCE at start-up (one small calculation) and then
// used as plain numbers, so the checks stay fast.
var DRIFT_BANDS = ['tf', 'tf0', 'tf1', 'tf2', 'grassp', 'lasting'];
// Greenness end-points for converting lasting NDVI into a share of green cover
// (fractional vegetation cover). Replaced at start-up with values measured in
// CAL_YEAR: bare = dense built-up cores, full green = stable tree canopy.
var FVC_SOIL = 0.12, FVC_VEG = 0.70;
var OFFSETS = {};          // key 'year_band' -> change since CAL_YEAR (band units, x1000)
var OFFSETS_READY = false;
function driftOffset(y, band) {
  return OFFSETS_READY ? (OFFSETS[y + '_' + band] || 0) : 0;
}
function loadOffsets(done) {
  if (!DRIFT_CORRECT || !has(CAL_YEAR)) { done('Drift correction off (' + CAL_YEAR + ' asset missing or disabled).'); return; }
  var bands = [];
  YEARS.forEach(function (y) {
    DRIFT_BANDS.forEach(function (b) { bands.push(img(y).select(b).rename(b + '_' + y)); });
  });
  var gpStack = ee.Image.cat(YEARS.map(function (y) { return img(y).select('grassp').rename('gp_' + y); }));
  var pctDict = gpStack.updateMask(INV_CAL).reduceRegion({
    reducer: ee.Reducer.percentile(QS, QS.map(function (q, i) { return 'q' + i; })),
    geometry: geom, scale: 30, maxPixels: 1e10, tileScale: 4});
  var meanDict = ee.Image.cat(bands).updateMask(INV_CAL).reduceRegion({reducer: ee.Reducer.mean(), geometry: geom,
    scale: 30, maxPixels: 1e10, tileScale: 4});
  var stableCanopy = WC2020.eq(10).and(worldCover.eq(10));
  var lastCal = img(CAL_YEAR).select('lasting').divide(10000);
  var endDict = ee.Dictionary({
    soil: lastCal.updateMask(INVARIANT).reduceRegion({reducer: ee.Reducer.percentile([5]), geometry: geom,
      scale: 30, maxPixels: 1e10, tileScale: 4}).get('lasting'),
    veg: lastCal.updateMask(stableCanopy).reduceRegion({reducer: ee.Reducer.percentile([95]), geometry: geom,
      scale: 30, maxPixels: 1e10, tileScale: 4}).get('lasting')});
  ee.Dictionary({mean: meanDict, pct: pctDict, ends: endDict}).evaluate(function (res, err) {
    if (err || !res) { DRIFT_CORRECT = false; GRASS_QMATCH = false; done('Drift correction unavailable: ' + err); return; }
    if (res.ends && res.ends.soil !== null && res.ends.veg !== null && res.ends.veg - res.ends.soil > 0.2) {
      FVC_SOIL = res.ends.soil; FVC_VEG = res.ends.veg;
    }
    print('Green-cover end-points (lasting NDVI): bare ' + fmt(FVC_SOIL, 3) + ', full green ' + fmt(FVC_VEG, 3));
    var m = res.mean;
    YEARS.forEach(function (y) {
      var v = QS.map(function (q, i) { return res.pct['gp_' + y + '_q' + i]; });
      if (v.every(function (x) { return x !== null && x !== undefined; })) PCT[y] = v;
    });
    PCT_READY = !!PCT[CAL_YEAR];
    var lines = [];
    YEARS.forEach(function (y) {
      DRIFT_BANDS.forEach(function (b) {
        var v = m[b + '_' + y], ref = m[b + '_' + CAL_YEAR];
        OFFSETS[y + '_' + b] = (v === null || v === undefined || ref === null || ref === undefined) ? 0 : v - ref;
      });
      lines.push(y + ': trees ' + fmt(OFFSETS[y + '_tf'] / 10, 1) + ' pts, grass prob ' + fmt(OFFSETS[y + '_grassp'] / 1000, 3));
    });
    OFFSETS_READY = true;
    print('Drift since ' + CAL_YEAR + ' on calibration land (removed):', lines.join('\n'));
    if (PCT_READY) {
      print('Year-matched grass cut-off (for a base cut of 0.3 / 0.5):', YEARS.map(function (y) {
        return y + ': ' + fmt(cutFor(y, 0.3, true), 3) + ' / ' + fmt(cutFor(y, 0.5, true), 3);
      }).join('\n'));
    }
    done('');
  });
}

// --- Year-matched grass cut-off ------------------------------------------
// On the calibration half of unchanging land, the share of pixels counted as
// grass must stay the same as in CAL_YEAR. For each year we find the cut-off
// that gives that same share (quantile matching), so on/off flicker caused
// by changing image conditions is removed while real new parks still count.
var QS = [0, 50, 60, 70, 80, 85, 88, 90, 92, 94, 95, 96, 97, 97.5, 98, 98.5, 99, 99.25, 99.5, 99.75, 100];
var PCT = {};             // year -> grass probability (x1000) at each percentile in QS
var PCT_READY = false;
function shareAbove(y, t) {          // share of calibration land with value >= t
  var v = PCT[y];
  if (t <= v[0]) return 1;
  if (t > v[v.length - 1]) return 0;
  for (var i = 1; i < v.length; i++) {
    if (v[i] >= t) {
      var q = v[i] === v[i - 1] ? QS[i - 1] : QS[i - 1] + (QS[i] - QS[i - 1]) * (t - v[i - 1]) / (v[i] - v[i - 1]);
      return 1 - q / 100;
    }
  }
  return 0;
}
function valueAt(y, q) {             // value at percentile q
  var v = PCT[y];
  if (q <= QS[0]) return v[0];
  for (var i = 1; i < QS.length; i++) {
    if (QS[i] >= q) return v[i - 1] + (v[i] - v[i - 1]) * (q - QS[i - 1]) / (QS[i] - QS[i - 1]);
  }
  return v[v.length - 1];
}
function cutFor(y, baseCut, qmatch) {
  if (!qmatch || !PCT_READY || y === CAL_YEAR || !PCT[y]) return baseCut;
  var s = shareAbove(CAL_YEAR, baseCut * 1000);
  if (!(s > 0) || s >= 1) return baseCut;
  return Math.max(0.05, Math.min(0.99, valueAt(y, 100 * (1 - s)) / 1000));
}
function useQ(opts) { return opts.qmatch === undefined ? GRASS_QMATCH : opts.qmatch; }
function corrected(y, band, drift) {
  var v = img(y).select(band);
  if (drift) v = v.subtract(ee.Image.constant(driftOffset(y, band)));
  return v.divide(1000).clamp(0, 1);
}
function useDrift(opts) { return opts.drift === undefined ? DRIFT_CORRECT : opts.drift; }

// Tree fraction: drift-corrected, optionally averaged with the neighbouring
// years, and set to 0 below the noise floor.
function treeFrac(y, opts) {
  opts = opts || {};
  var band = opts.band || 'tf';
  var smooth = opts.smooth === undefined ? TREE_SMOOTH : opts.smooth;
  var floor = opts.floor === undefined ? TREE_FLOOR : opts.floor;
  var years = smooth ? [y - 1, y, y + 1].filter(has) : [y];
  var tf = ee.ImageCollection(years.map(function (yy) { return corrected(yy, band, useDrift(opts)); })).mean();
  return tf.where(tf.lt(floor), 0).rename('tf');
}
// With year-matching on, the probability itself is left uncorrected (the cut-off moves instead).
function grassProb(y, opts) {
  opts = opts || {};
  return corrected(y, 'grassp', useDrift(opts) && !useQ(opts)).rename('gp');
}
function grassMask(y, opts) {
  opts = opts || {};
  var base = opts.cut === undefined ? GRASS_CUT : opts.cut;
  var cut = cutFor(y, base, useQ(opts));
  var gp = grassProb(y, opts);
  return gp.gte(cut)
    .and(gp.gt(img(y).select('cropp').divide(1000)))
    .and(treeFrac(y, opts).lt(MAX_TREE_UNDER_GRASS)).rename('grass');
}
// --- Grass as a SHARE of each pixel (default) -----------------------------
// green share = lasting NDVI scaled between bare (0) and full green (1);
// grass share = green share - tree share, weighted by (1 - crop probability),
// so crops drop out smoothly and nothing flips on/off between years.
function lastingN(y, drift) {
  var v = img(y).select('lasting');
  if (drift) v = v.subtract(ee.Image.constant(driftOffset(y, 'lasting')));
  return v.divide(10000);
}
function grassFracYear(y, opts) {
  var soil = opts.soil === undefined ? FVC_SOIL : opts.soil;
  var veg = opts.veg === undefined ? FVC_VEG : opts.veg;
  var green = lastingN(y, useDrift(opts)).subtract(soil).divide(veg - soil).clamp(0, 1);
  var tfy = treeFrac(y, {smooth: false, band: opts.band, drift: opts.drift, floor: opts.floor});
  var crop = img(y).select('cropp').divide(1000).clamp(0, 1);
  return green.subtract(tfy).max(0).multiply(ee.Image(1).subtract(crop)).multiply(worldCover.neq(80));
}
function grassFrac(y, opts) {
  opts = opts || {};
  var smooth = opts.smooth === undefined ? TREE_SMOOTH : opts.smooth;
  var years = smooth ? [y - 1, y, y + 1].filter(has) : [y];
  return ee.ImageCollection(years.map(function (yy) { return grassFracYear(yy, opts); })).mean().rename('gfrac');
}
function grassMethod(opts) { return (opts && opts.grassMethod) || GRASS_METHOD; }
function treeAreaImg(y, opts) { return treeFrac(y, opts).multiply(AREA).rename('trees'); }
function grassAreaImg(y, opts) {
  if (grassMethod(opts) === 'binary') {
    return grassMask(y, opts).multiply(ee.Image(1).subtract(treeFrac(y, opts))).multiply(AREA).rename('grass');
  }
  return grassFrac(y, opts).multiply(AREA).rename('grass');
}
function greenAreaImg(y, opts) { return treeAreaImg(y, opts).add(grassAreaImg(y, opts)).rename('green'); }

// Background land classes for display (from Dynamic World): 3 crops/other veg,
// 4 built-up, 5 water, 6 bare
function background(y) {
  var a = img(y).select('dwarg');
  return ee.Image(3).where(a.eq(6), 4).where(a.eq(0), 5).where(a.eq(7).or(a.eq(8)), 6)
    .updateMask(a.mask()).clip(geom).rename('bg');
}
// Comparison methods for C7
function dwGreen(y) {
  var a = img(y).select('dwarg');
  return a.eq(1).or(a.eq(2)).or(a.eq(3)).or(a.eq(5));
}
function ruleGreen(y) { return img(y).select('rule').eq(1); }

// ---------------------------------------------------------------------
// 4. STYLES, FONT, STATISTICS
// ---------------------------------------------------------------------
var CLEAR = 'rgba(0,0,0,0)';
var TREE_PAL = ['#5bb36a', '#2f8f46', '#1b7837', '#0b5a2a', '#00441b'];
var TREE_VIS = {min: 0.15, max: 0.8, palette: TREE_PAL};
var TREE_SHOW = 0.15;      // display only: show trees where they cover >= 15 % of a pixel
var GRASS_SHOW = 0.25;     // display only: show grass where it covers >= 25 % of a pixel
var GRASS_COL = '#b8e186';
var GRASS_VIS = {min: 0.25, max: 0.75, palette: ['#d4ec8a', '#b5d950', '#93c02c']};
var BG = [[3, '#efe6cf', 'Crops & other (not counted)'], [4, '#bdbdbd', 'Built-up'],
          [5, '#2b8cbe', 'Water'], [6, '#e3cfae', 'Bare ground']];
var BG_VIS = {min: 3, max: 6, palette: BG.map(function (b) { return b[1]; })};

var FONT = {
  '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'], '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '001', '001', '001'],
  '8': ['111', '101', '111', '101', '111'], '9': ['111', '101', '111', '001', '111'],
  'A': ['010', '101', '111', '101', '101'], 'B': ['110', '101', '110', '101', '110'],
  'C': ['011', '100', '100', '100', '011'], 'D': ['110', '101', '101', '101', '110'],
  'E': ['111', '100', '110', '100', '111'], 'F': ['111', '100', '110', '100', '100'],
  'G': ['011', '100', '101', '101', '011'], 'H': ['101', '101', '111', '101', '101'],
  'I': ['111', '010', '010', '010', '111'], 'J': ['001', '001', '001', '101', '010'],
  'K': ['101', '101', '110', '101', '101'], 'L': ['100', '100', '100', '100', '111'],
  'M': ['101', '111', '111', '101', '101'], 'N': ['110', '101', '101', '101', '101'],
  'O': ['010', '101', '101', '101', '010'], 'P': ['110', '101', '110', '100', '100'],
  'Q': ['010', '101', '101', '110', '011'], 'R': ['110', '101', '110', '101', '101'],
  'S': ['011', '100', '010', '001', '110'], 'T': ['111', '010', '010', '010', '010'],
  'U': ['101', '101', '101', '101', '111'], 'V': ['101', '101', '101', '101', '010'],
  'W': ['101', '101', '111', '111', '101'], 'X': ['101', '101', '010', '101', '101'],
  'Y': ['101', '101', '010', '010', '010'], 'Z': ['111', '001', '010', '100', '111'],
  ',': ['000', '000', '000', '010', '100'], '/': ['001', '001', '010', '100', '100'],
  '-': ['000', '000', '111', '000', '000'], '&': ['010', '101', '010', '101', '011'],
  '(': ['010', '100', '100', '100', '010'], ')': ['010', '001', '001', '001', '010'],
  '%': ['101', '001', '010', '100', '101']
};
function textCells(str, lon0, lat0, cell) {
  var cells = [], cx = 0;
  String(str).toUpperCase().split('').forEach(function (ch) {
    var g = FONT[ch];
    if (g) {
      for (var r = 0; r < 5; r++) {
        for (var c = 0; c < 3; c++) {
          if (g[r].charAt(c) === '1') {
            var x = lon0 + (cx + c) * cell, yy = lat0 - r * cell;
            cells.push(ee.Feature(ee.Geometry.Rectangle([x, yy - cell, x + cell, yy])));
          }
        }
      }
    }
    cx += 4;
  });
  return {cells: cells, width: cx * cell};
}
function textOnly(str, lon0, lat0, cell) {
  return ee.Image().byte().paint(ee.FeatureCollection(textCells(str, lon0, lat0, cell).cells), 1)
    .visualize({palette: ['000000']});
}
function textBox(str, lon0, lat0, cell) {
  var t = textCells(str, lon0, lat0, cell);
  var box = ee.Geometry.Rectangle([lon0 - cell, lat0 - 6 * cell, lon0 + t.width, lat0 + cell]);
  return ee.Image(1).clip(box).visualize({palette: ['ffffff']})
    .blend(ee.Image().byte().paint(ee.FeatureCollection(t.cells), 1).visualize({palette: ['000000']}));
}

function normCdf(z) {
  var t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  var e = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t +
    0.254829592) * t * Math.exp(-z * z / 2);
  return z >= 0 ? 0.5 * (1 + e) : 0.5 * (1 - e);
}
function mannKendallSen(xs, ys) {
  var n = ys.length, S = 0, slopes = [];
  for (var i = 0; i < n - 1; i++) {
    for (var j = i + 1; j < n; j++) {
      var d = ys[j] - ys[i];
      S += d > 0 ? 1 : d < 0 ? -1 : 0;
      slopes.push(d / (xs[j] - xs[i]));
    }
  }
  slopes.sort(function (a, b) { return a - b; });
  var m = slopes.length;
  if (!m) return {S: 0, z: 0, p: 1, sen: 0, n: n};
  var sen = m % 2 ? slopes[(m - 1) / 2] : (slopes[m / 2 - 1] + slopes[m / 2]) / 2;
  var varS = n * (n - 1) * (2 * n + 5) / 18;
  var z = S > 0 ? (S - 1) / Math.sqrt(varS) : S < 0 ? (S + 1) / Math.sqrt(varS) : 0;
  return {S: S, z: z, p: 2 * (1 - normCdf(Math.abs(z))), sen: sen, n: n};
}
function senCI(xs, ys) {
  var s = [], n = ys.length;
  for (var i = 0; i < n - 1; i++) for (var j = i + 1; j < n; j++) s.push((ys[j] - ys[i]) / (xs[j] - xs[i]));
  s.sort(function (a, b) { return a - b; });
  var N = s.length;
  if (N < 3) return {lo: NaN, hi: NaN};
  var C = 1.96 * Math.sqrt(n * (n - 1) * (2 * n + 5) / 18);
  var lo = Math.round((N - C) / 2) - 1, hi = Math.round((N + C) / 2);
  return {lo: s[Math.max(0, Math.min(N - 1, lo))], hi: s[Math.max(0, Math.min(N - 1, hi))]};
}
function pearson(a, b) {
  var n = a.length, ma = 0, mb = 0;
  for (var i = 0; i < n; i++) { ma += a[i] / n; mb += b[i] / n; }
  var sab = 0, saa = 0, sbb = 0;
  for (var j = 0; j < n; j++) {
    sab += (a[j] - ma) * (b[j] - mb); saa += (a[j] - ma) * (a[j] - ma); sbb += (b[j] - mb) * (b[j] - mb);
  }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
}
function fmt(x, d) { return x === null || x === undefined || isNaN(x) ? 'n/a' : Number(x).toFixed(d); }
function pctTxt(x) { return (x >= 0 ? '+' : '') + fmt(x, 0) + '%'; }

// ---------------------------------------------------------------------
// 5. LAYOUT: header band, navigation panel, one content area per tab
// ---------------------------------------------------------------------
// After publishing the polished timelapse GIF (e.g. on GitHub), paste its
// direct image link here and the Timelapse page will show it:
var TIMELAPSE_GIF_URL = 'https://cdn.jsdelivr.net/gh/ejazsarwar1/Lahore-Green-Cover@main/graphics/lahore_green_timelapse_app.gif';
var TIMELAPSE_FULL_URL = 'https://github.com/ejazsarwar1/Lahore-Green-Cover/blob/main/graphics/lahore_green_timelapse.gif';

var COL = {dark: '#14532d', green: '#1b7837', light: '#eef5ec', line: '#cfe3cb', ink: '#212529',
           muted: '#5f6b66', red: '#b2182b'};
var GREEN_TXT = COL.green, RED_TXT = COL.red;
var SMALL = {fontSize: '12px', color: '#555', margin: '2px 8px'};
var MONO = {whiteSpace: 'pre-wrap', fontSize: '12px', fontFamily: 'monospace', margin: '2px 8px'};
var HEADING = {fontWeight: 'bold', fontSize: '16px', color: COL.dark, margin: '14px 8px 4px 8px'};
var PARA = {fontSize: '13px', color: '#333', margin: '4px 8px', whiteSpace: 'pre-wrap', maxWidth: '900px'};
var IS_PHONE = false;

// --- Header band
var titleLabel = ui.Label('Lahore Non-Crop Green Cover, 2019–2026', {fontWeight: 'bold', fontSize: '22px',
  color: '#ffffff', backgroundColor: COL.dark, margin: '8px 8px 0 8px', textAlign: 'center', stretch: 'horizontal'});
var subtitleLabel = ui.Label('Trees, grass, lawns and parks mapped from space every year · crops excluded · ' +
  'Sentinel-2 satellite images, 10 m', {fontSize: '13px', color: '#d9f0d3', backgroundColor: COL.dark,
  margin: '4px 8px 2px 8px', textAlign: 'center', stretch: 'horizontal'});
// author byline, linked to the project on GitHub
var bylineLabel = ui.Label('A study by Muhammad Ejaz Sarwar (PAS)',
  {fontSize: '12px', fontStyle: 'italic', color: '#a6dba0', backgroundColor: COL.dark,
   margin: '2px 8px 8px 8px', textAlign: 'center', stretch: 'horizontal'},
  'https://github.com/ejazsarwar1/Lahore-Green-Cover');
var header = ui.Panel([titleLabel, subtitleLabel, bylineLabel], null,
  {stretch: 'horizontal', backgroundColor: COL.dark, padding: '4px 0', margin: '0'});
var status = ui.Label('Loading…', {fontSize: '12px', color: '#a15c00', margin: '4px 8px',
  textAlign: 'center', stretch: 'horizontal'});
function setStatus(text) {
  status.setValue(text || '');
  status.style().set('shown', !!text);
}

// --- Navigation tabs: a button with a bar underneath; the bar turns green on the open tab
function chip(label, onClick) {
  var btn = ui.Button({label: label, onClick: onClick, style: {margin: '0', fontSize: '13px'}});
  var bar = ui.Label('', {height: '4px', padding: '0', margin: '1px 6px 0 6px', stretch: 'horizontal',
    backgroundColor: COL.light});
  var wrap = ui.Panel([btn, bar], null, {padding: '0', margin: '2px 3px', backgroundColor: COL.light});
  return {wrap: wrap, btn: btn, bar: bar};
}
function setChip(c, on) {
  c.bar.style().set('backgroundColor', on ? COL.green : COL.light);
  c.btn.style().set({fontWeight: on ? 'bold' : 'normal', color: on ? COL.green : COL.ink});
}
var navLabels = [];
function navLabel(text) {
  var l = ui.Label(text, {width: '110px', margin: '11px 4px 0 12px', fontWeight: 'bold', fontSize: '13px',
    color: COL.dark, backgroundColor: COL.light});
  navLabels.push(l);
  return l;
}
// A layout object can belong to only one panel, so every row gets its own.
function wrapRow() { return ui.Panel.Layout.flow('horizontal', true); }
function navRow(widgets) {
  return ui.Panel(widgets, wrapRow(), {backgroundColor: COL.light, stretch: 'horizontal', margin: '0', padding: '0'});
}
var selectedYear = null;
var mode = 'year';
var yearChips = {};
var yearRow = navRow([]);
var areaSelect = ui.Select({items: ['All of Lahore'].concat(PLACES.map(function (p) { return p[0]; })),
  value: 'All of Lahore', onChange: function (v) { zoomTo(v); }, style: {margin: '4px 4px'}});
var changeChip = chip('Change \u2192', function () { setMode('change'); });
var timelapseChip = chip('Timelapse', function () { setMode('timelapse'); });
var benchChip = chip('Lahore vs Benchmarks', function () { setMode('bench'); });
var howChip = chip('How We Know', function () { setMode('methods'); });
var aboutChip = chip('About & Data', function () { setMode('about'); });
var exploreRow = navRow([navLabel('Explore'), changeChip.wrap, timelapseChip.wrap, benchChip.wrap,
  ui.Label('Zoom to neighbourhood:', {margin: '11px 4px 0 24px', fontSize: '13px', color: COL.dark,
    backgroundColor: COL.light}), areaSelect]);
var learnRow = navRow([navLabel('Learn more'), howChip.wrap, aboutChip.wrap]);
var nav = ui.Panel([yearRow, exploreRow, learnRow], null, {backgroundColor: COL.light, stretch: 'horizontal',
  margin: '0 0 6px 0', padding: '4px 0', border: '1px solid ' + COL.line});

function styleNav() {
  Object.keys(yearChips).forEach(function (k) {
    var on = mode === 'year' && Number(k) === selectedYear;
    setChip(yearChips[k], on);
  });
  setChip(changeChip, mode === 'change');
  setChip(timelapseChip, mode === 'timelapse');
  setChip(benchChip, mode === 'bench');
  setChip(howChip, mode === 'methods');
  setChip(aboutChip, mode === 'about');
  changeChip.btn.setLabel('Change ' + chFrom.getValue() + ' → ' + chTo.getValue());
}

// --- Map (shared by the yearly view and the change view)
var GREY = [{stylers: [{saturation: -100}, {lightness: 25}]},
            {featureType: 'poi', stylers: [{visibility: 'off'}]}];
var map = ui.Map();
map.setOptions('Grey', {Grey: GREY}, ['Grey', 'HYBRID']);
map.setControlVisibility({zoomControl: true, scaleControl: true, mapTypeControl: true,
  layerList: true, fullscreenControl: true, drawingToolsControl: false});
map.style().set({height: MAP_HEIGHT, stretch: 'horizontal', cursor: 'crosshair', margin: '0 8px'});
var yearBadge = ui.Label('', {fontWeight: 'bold', fontSize: '22px', padding: '2px 10px',
  margin: '0', color: COL.dark, backgroundColor: 'rgba(255,255,255,0.92)'});
map.add(ui.Panel([yearBadge], null, {position: 'top-left', padding: '0'}));
var legendHolder = ui.Panel(null, null, {position: 'bottom-left', padding: '0', backgroundColor: CLEAR});
map.add(legendHolder);
var legendBelow = ui.Panel(null, null, {margin: '4px 8px'});   // used on phones
function showLegend(widget) {
  legendHolder.clear();
  legendBelow.clear();
  (IS_PHONE ? legendBelow : legendHolder).add(widget);
}

// --- Controls for the map views (one persistent row, refilled per tab)
var viewSelect = ui.Select({items: ['Green cover', 'True Color (Satellite View)'],
  value: 'Green cover', onChange: function () { if (selectedYear) renderYear(selectedYear); },
  style: {margin: '6px 4px'}});
var contextBox = ui.Checkbox({label: 'Show crops, built-up, bare (faint)', value: true,
  onChange: function () { if (mode === 'change') renderChange(); else if (selectedYear) renderYear(selectedYear); },
  style: {margin: '13px 10px 0 16px'}});
var chFrom = ui.Select({items: ALL_YEARS.map(String), value: '2019', onChange: function () { renderChange(); },
  style: {margin: '6px 4px'}});
var chTo = ui.Select({items: ALL_YEARS.map(String), value: '2025', onChange: function () { renderChange(); },
  style: {margin: '6px 4px'}});
var controls = ui.Panel([], wrapRow(), {stretch: 'horizontal', margin: '0 4px'});
function controlsRow(widgets) {
  controls.clear();
  widgets.forEach(function (w) { controls.add(w); });
  return controls;
}
function ctrlLabel(text) {
  return ui.Label(text, {margin: '13px 4px 0 8px', fontWeight: 'bold', fontSize: '13px', color: COL.muted});
}

// --- Key-number cards, stacked in a column to the right of the map
function makeCard(caption, colour) {
  var num = ui.Label('\u2013', {fontSize: '24px', fontWeight: 'bold', color: colour || COL.ink, margin: '0'});
  var cap = ui.Label(caption, {fontSize: '12px', color: '#666', margin: '2px 0 0 0'});
  var p = ui.Panel([num, cap], null, {border: '1px solid #ddd', padding: '8px 12px', margin: '4px 0',
    stretch: 'horizontal', backgroundColor: '#ffffff'});
  return {panel: p, num: num, cap: cap};
}
var cTrees = makeCard('Tree cover', COL.green), cGrass = makeCard('Grass, lawns, parks', '#5a8f00');
var cTotal = makeCard('Total non-crop green', COL.green), cShare = makeCard('Share of Lahore');
var dTotal = makeCard('Net change in non-crop green'), dTrees = makeCard('Change in tree cover');
var dGrass = makeCard('Change in grass, lawns, parks'), dSplit = makeCard('Land that gained / lost green');
var ALL_CARDS = [cTrees, cGrass, cTotal, cShare, dTotal, dTrees, dGrass, dSplit];
var yearCards = ui.Panel([cTrees.panel, cGrass.panel, cTotal.panel, cShare.panel], null, {margin: '0'});
var changeCards = ui.Panel([dTotal.panel, dTrees.panel, dGrass.panel, dSplit.panel], null, {margin: '0'});
var sideTitle = ui.Label('', {fontWeight: 'bold', fontSize: '15px', color: COL.dark, margin: '0 0 4px 0'});
var cardsBox = ui.Panel(null, null, {margin: '0'});
var cardsNote = ui.Label('District statistics are hidden while you are zoomed to a neighbourhood. ' +
  'Choose "All of Lahore" to see them again.', {fontSize: '12px', color: COL.muted, margin: '6px 0',
  whiteSpace: 'pre-wrap'});
var changeNote = ui.Label('', {fontSize: '12px', color: '#555', margin: '6px 0', whiteSpace: 'pre-wrap'});
var inspectLabel = ui.Label('Click the map to read values at a point.',
  {fontSize: '12px', color: '#333', margin: '8px 0', whiteSpace: 'pre-wrap'});
var sidePanel = ui.Panel([sideTitle, cardsBox, cardsNote, changeNote, inspectLabel], null,
  {width: '270px', margin: '0 8px 0 0', padding: '0'});
// Loading indicator floating on the map (it never moves the layout). Earth Engine does not report tile
// progress, so it takes three quick steps on a timer and shows 100% when the view's data arrives. It only
// changes a few labels, so the map and the numbers load exactly as fast as without it.
var loadText = ui.Label('', {fontSize: '12px', fontWeight: 'bold', color: COL.green, margin: '0 0 3px 0',
  backgroundColor: CLEAR});
var loadFill = ui.Label('', {backgroundColor: COL.green, height: '5px', width: '0%', margin: '0', padding: '0'});
var loadTrack = ui.Panel([loadFill], null, {backgroundColor: '#dcebd8', height: '5px', width: '180px',
  margin: '0', padding: '0'});
var loadBar = ui.Panel([loadText, loadTrack], null, {position: 'top-center', padding: '6px 10px', shown: false,
  backgroundColor: 'rgba(255,255,255,0.92)'});
map.add(loadBar);
var LOAD = {id: 0};
function showLoad(msg, pct) {
  loadText.setValue(msg + '\u2026 ' + pct + '%');
  loadFill.style().set('width', pct + '%');
}
function startLoading(msg) {
  var id = ++LOAD.id;
  showLoad(msg, 25);
  loadBar.style().set('shown', true);
  [[1200, 60], [3000, 85]].forEach(function (step) {
    ui.util.setTimeout(function () { if (id === LOAD.id) showLoad(msg, step[1]); }, step[0]);
  });
  return id;
}
function finishLoading() {
  ++LOAD.id;   // cancels the remaining steps
  loadBar.style().set('shown', false);
}
var mapColumn = ui.Panel([map, legendBelow], null, {stretch: 'horizontal', margin: '0', padding: '0'});
var mapRow = ui.Panel([mapColumn, sidePanel], ui.Panel.Layout.flow('horizontal'),
  {stretch: 'horizontal', margin: '0', padding: '0'});
function isWholeCity() { return !areaSelect.getValue() || areaSelect.getValue() === 'All of Lahore'; }
function updateCardVisibility() {
  var whole = isWholeCity() || mode === 'bench';
  cardsBox.style().set('shown', whole);
  cardsNote.style().set('shown', !whole);
}

// --- Timelapse page
var gifHolder = ui.Panel();
var gifButton = ui.Button({label: 'Build the timelapse in this app', onClick: function () { makeTimelapse(); }});

// --- How We Know (verification) widgets
var CHECKS = [
  ['C1', 'Clear-image coverage across the whole city'],
  ['C2', 'Tree fraction stable in protected forests and stable canopy'],
  ['C3', 'Tree fraction vs held-out 1 m canopy (bias, accuracy)'],
  ['C4', 'Grass found in held-out OSM parks; few false grass in crops/built'],
  ['C5', 'False change on land that cannot change'],
  ['C6', 'Change is robust to model settings'],
  ['C7', 'Three methods agree on direction'],
  ['C8', 'Grass / crop classifier accuracy on held-out points'],
  ['C9', 'Trend and 95% confidence interval'],
  ['C10', 'Independent: tree change vs NASA GEDI laser canopy heights'],
  ['C11', 'Independent: green lost where new buildings appeared (Open Buildings)'],
  ['D1', 'Diagnostic: spread between the 3 tree models'],
  ['D2', 'Diagnostic: green area vs rainfall']
];
var scoreRows = {};
var scorePanel = ui.Panel(null, null, {border: '1px solid #ccc', margin: '4px 8px', padding: '4px'});
CHECKS.forEach(function (c) {
  var st = ui.Label('\u2022 not run', {fontSize: '12px', margin: '2px 6px', width: '110px'});
  var detail = ui.Label('', {fontSize: '12px', margin: '0 6px 4px 18px', color: '#444', whiteSpace: 'pre-wrap'});
  scoreRows[c[0]] = {status: st, detail: detail};
  var name = ui.Label(c[0] + '  ' + c[1], {fontSize: '12px', margin: '2px 6px', stretch: 'horizontal',
    fontWeight: c[0].charAt(0) === 'C' ? 'bold' : 'normal'});
  scorePanel.add(ui.Panel([ui.Panel([name, st], ui.Panel.Layout.flow('horizontal')), detail], null,
    {margin: '0', padding: '2px 0'}));
});
var verdict = ui.Label('Verdict: not yet assessed.', {fontSize: '14px', fontWeight: 'bold',
  margin: '6px 8px', whiteSpace: 'pre-wrap'});
var detailHolder = ui.Panel();
var exportMsg = ui.Label('', SMALL);

var content = ui.Panel(null, ui.Panel.Layout.flow('vertical'), {stretch: 'horizontal'});
var main = ui.Panel([header, status, nav, content], ui.Panel.Layout.flow('vertical'),
  {stretch: 'both', padding: '0'});
ui.root.clear();
ui.root.add(main);

// ---------------------------------------------------------------------
// 6. TABS AND RENDERING
// ---------------------------------------------------------------------
function legend() {
  var p = ui.Panel(null, null, {padding: '6px 8px', backgroundColor: 'rgba(255,255,255,0.94)',
    width: IS_PHONE ? 'auto' : '250px'});
  p.add(ui.Label('Tree cover (share of each 10 m pixel)', {fontWeight: 'bold', fontSize: '12px',
    margin: '0 0 2px 0', backgroundColor: CLEAR}));
  p.add(ui.Thumbnail({image: ee.Image.pixelLonLat().select(0),
    params: {bbox: [0, 0, 1, 0.1], dimensions: '220x12', format: 'png', min: 0, max: 1, palette: TREE_PAL},
    style: {stretch: 'horizontal', margin: '2px 0'}}));
  p.add(ui.Panel(['15%', '35%', '55%', '80%+'].map(function (t, i) {
    return ui.Label(t, {fontSize: '11px', margin: '0', backgroundColor: CLEAR, stretch: 'horizontal',
      textAlign: i === 0 ? 'left' : i === 3 ? 'right' : 'center'});
  }), ui.Panel.Layout.flow('horizontal'), {backgroundColor: CLEAR}));
  var rows = [[GRASS_COL, 'Grass, lawns, parks', true]];
  if (contextBox.getValue()) rows = rows.concat(BG.map(function (b) { return [b[1], b[2], false]; }));
  else rows.push(['#2b8cbe', 'Water', false]);
  rows.forEach(function (r) {
    p.add(ui.Panel([
      ui.Label('', {backgroundColor: r[0], padding: '6px 9px', margin: '3px 6px 0 0', border: '1px solid #888'}),
      ui.Label(r[1], {fontSize: '12px', margin: '3px 0 0 0', backgroundColor: CLEAR, fontWeight: r[2] ? 'bold' : 'normal'})
    ], ui.Panel.Layout.flow('horizontal'), {backgroundColor: CLEAR}));
  });
  return p;
}
var CHANGE_VIS = {min: -0.12, max: 0.12,
  palette: ['#b2182b', '#d6604d', '#f4a582', '#f7f7f7', '#a6dba0', '#5aae61', '#1b7837']};
function changeLegend(y0, y1) {
  var p = ui.Panel(null, null, {padding: '6px 8px', backgroundColor: 'rgba(255,255,255,0.94)',
    width: IS_PHONE ? 'auto' : '260px'});
  p.add(ui.Label('Change in green share, ' + y0 + ' → ' + y1, {fontWeight: 'bold', fontSize: '12px',
    margin: '0 0 2px 0', backgroundColor: CLEAR}));
  p.add(ui.Thumbnail({image: ee.Image.pixelLonLat().select(0),
    params: {bbox: [0, 0, 1, 0.1], dimensions: '230x12', format: 'png', min: 0, max: 1, palette: CHANGE_VIS.palette},
    style: {stretch: 'horizontal', margin: '2px 0'}}));
  p.add(ui.Panel([['Green lost', 'left', RED_TXT], ['No change', 'center', '#666'], ['Green gained', 'right', GREEN_TXT]]
    .map(function (t) {
      return ui.Label(t[0], {fontSize: '11px', margin: '0', backgroundColor: CLEAR, stretch: 'horizontal',
        textAlign: t[1], color: t[2]});
    }), ui.Panel.Layout.flow('horizontal'), {backgroundColor: CLEAR}));
  p.add(ui.Label('±12 percentage points of each pixel; changes under 2 points not shown.',
    {fontSize: '11px', color: '#666', margin: '4px 0 0 0', backgroundColor: CLEAR}));
  return p;
}
function contextLayers() {
  return [ui.Map.Layer(outsideDim, {palette: ['ffffff']}, 'Outside Lahore (dimmed)', true, 0.75),
          ui.Map.Layer(outline, {}, 'Lahore boundary'),
          ui.Map.Layer(placeDots, {}, 'Place markers'),
          ui.Map.Layer(ee.FeatureCollection(OSM_ASSET).style({color: 'ff00ff', fillColor: '00000000', width: 1}),
            {}, 'OpenStreetMap green spaces', false)];
}

function buildTabs() {
  yearRow.clear();
  yearChips = {};
  yearRow.add(navLabel('Year'));
  ALL_YEARS.forEach(function (yr) {
    var c = chip(String(yr) + (isProvisional(yr) ? '*' : ''), function () { selectedYear = yr; setMode('year'); });
    c.btn.setDisabled(!has(yr));
    yearChips[yr] = c;
    yearRow.add(c.wrap);
  });
}

function zoomTo(v) {
  var whole = !v || v === 'All of Lahore';
  var redraw = contextBox.getValue() !== whole;
  contextBox.setValue(whole, false);   // faint crops/built-up/bare off near a neighbourhood: street names show through
  if (mode !== 'year' && mode !== 'change' && mode !== 'bench') setMode('year');
  else if (redraw && mode === 'year') renderYear(selectedYear);
  else if (redraw && mode === 'change') renderChange();
  if (!v || v === 'All of Lahore') map.centerObject(lahore);
  else {
    var p = PLACES.filter(function (q) { return q[0] === v; })[0];
    if (p) map.setCenter(p[1], p[2], IS_PHONE ? 13 : 14);
  }
  updateCardVisibility();
}

function setMode(m) {
  mode = m;
  content.clear();
  if (m === 'year' || m === 'change') {
    cardsBox.clear();
    cardsBox.add(m === 'year' ? yearCards : changeCards);
    changeNote.style().set('shown', m === 'change');
    inspectLabel.setValue('Click the map to read values at a point.');
    content.add(m === 'year' ? controlsRow([ctrlLabel('Map view:'), viewSelect, contextBox])
                             : controlsRow([ctrlLabel('Compare'), chFrom, ctrlLabel('with'), chTo, contextBox]));
    content.add(mapRow);
    if (m === 'year') renderYear(selectedYear); else renderChange();
  } else if (m === 'bench') {
    cardsBox.clear();
    cardsBox.add(benchCards);
    changeNote.style().set('shown', false);
    inspectLabel.setValue('Click the map to see a neighbourhood against the benchmarks.');
    if (!bmYear.getValue()) bmYear.setValue(String(lastComplete() || YEARS[YEARS.length - 1]), false);
    content.add(controlsRow([ctrlLabel('Year:'), bmYear]));
    content.add(mapRow);
    content.add(bmNote);
    renderBenchmarks();
  } else if (m === 'timelapse') {
    content.add(timelapsePanel());
  } else if (m === 'methods') {
    content.add(methodsPanel());
  } else {
    content.add(aboutPanel());
  }
  updateCardVisibility();
  styleNav();
}

function renderYear(y) {
  if (!y) return;
  styleNav();
  yearBadge.setValue(y + (isProvisional(y) ? ' (provisional)' : ''));
  sideTitle.setValue('Lahore in ' + y + (isProvisional(y) ? ' (provisional)' : ''));
  if (viewSelect.getValue() === 'Green cover') {
    var L = layersFor(y);
    map.layers().reset([ui.Map.Layer(L.bg, BG_VIS, 'Background ' + y),
      ui.Map.Layer(L.grass, grassMethod() === 'binary' ? {palette: [GRASS_COL]} : GRASS_VIS, 'Grass, lawns, parks ' + y),
      ui.Map.Layer(L.trees, TREE_VIS, 'Tree cover ' + y)].concat(contextLayers()));
    showLegend(legend());
  } else {
    map.layers().reset([ui.Map.Layer(img(y).select(['red', 'green', 'blue']).divide(10000),
      {min: 0.02, max: 0.25, gamma: 1.2}, 'Satellite view ' + y)].concat(contextLayers()));
    legendHolder.clear(); legendBelow.clear();
  }
  updateCards(y);
}

function layersFor(y) {
  var bg = background(y);
  if (!contextBox.getValue()) bg = bg.updateMask(bg.eq(5));
  var gf = grassMethod() === 'binary' ? grassMask(y).selfMask() : grassFrac(y);
  var g = grassMethod() === 'binary' ? gf : gf.updateMask(gf.gte(GRASS_SHOW));
  var tf = treeFrac(y);
  return {bg: bg, grass: g, trees: tf.updateMask(tf.gte(TREE_SHOW))};   // display only; all shares are counted
}

var statsRequest = 0;
function updateCards(y) {
  var id = ++statsRequest;
  startLoading('Loading the ' + y + ' map');
  [cTrees, cGrass, cTotal, cShare].forEach(function (c) { c.num.setValue('…'); });
  ee.Image.cat([treeAreaImg(y), grassAreaImg(y), AREA.rename('all')]).clip(geom)
    .reduceRegion({reducer: ee.Reducer.sum(), geometry: geom, scale: STAT_SCALE, maxPixels: 1e11, tileScale: 4})
    .evaluate(function (r, err) {
      if (id !== statsRequest) return;
      finishLoading();
      if (err) { cTotal.num.setValue('error'); setStatus('Error: ' + err); return; }
      var t = r.trees || 0, g = r.grass || 0;
      cTrees.num.setValue(fmt(t, 1) + ' km²');
      cGrass.num.setValue(fmt(g, 1) + ' km²');
      cTotal.num.setValue(fmt(t + g, 1) + ' km²');
      cShare.num.setValue(fmt(100 * (t + g) / r.all, 1) + '%');
      cShare.cap.setValue('Share of Lahore that is non-crop green in ' + y + (isProvisional(y) ? ' (provisional)' : ''));
    });
}

function renderChange() {
  if (mode !== 'change') { styleNav(); return; }
  var y0 = Number(chFrom.getValue()), y1 = Number(chTo.getValue());
  styleNav();
  if (!has(y0) || !has(y1) || y0 === y1) {
    changeNote.setValue('Choose two different years that are available.');
    return;
  }
  yearBadge.setValue(y0 + ' → ' + y1 + (isProvisional(y1) || isProvisional(y0) ? ' (provisional)' : ''));
  showLegend(changeLegend(y0, y1));
  sideTitle.setValue('What changed, ' + y0 + ' → ' + y1);
  var dShare = greenAreaImg(y1).subtract(greenAreaImg(y0)).divide(AREA)
    .focalMean(150, 'circle', 'meters').clip(geom);
  var bg = background(y1);
  if (!contextBox.getValue()) bg = bg.updateMask(bg.eq(5));
  map.layers().reset([ui.Map.Layer(bg, BG_VIS, 'Background ' + y1, contextBox.getValue(), 0.5),
    ui.Map.Layer(dShare.updateMask(dShare.abs().gte(0.02)), CHANGE_VIS, 'Change in green share ' + y0 + '→' + y1)]
    .concat(contextLayers()));
  changeNote.setValue((isProvisional(y1) || isProvisional(y0) ? 'Note: a provisional (incomplete) year is selected. ' : '') +
    'Year-to-year ups and downs are partly weather-related; see "How We Know" for whether the change is ' +
    'statistically established.');
  [dTotal, dTrees, dGrass, dSplit].forEach(function (c) { c.num.setValue('…'); });
  var id = ++statsRequest;
  startLoading('Loading the change map');
  var dT = treeAreaImg(y1).subtract(treeAreaImg(y0)), dG = grassAreaImg(y1).subtract(grassAreaImg(y0));
  var d = dT.add(dG).divide(AREA);
  ee.Image.cat([treeAreaImg(y0).rename('t0'), grassAreaImg(y0).rename('g0'), dT.rename('dT'), dG.rename('dG'),
                AREA.updateMask(d.gte(0.1)).rename('up'), AREA.updateMask(d.lte(-0.1)).rename('down')])
    .clip(geom).reduceRegion({reducer: ee.Reducer.sum(), geometry: geom, scale: STAT_SCALE, maxPixels: 1e11, tileScale: 4})
    .evaluate(function (r, err) {
      if (id !== statsRequest) return;
      finishLoading();
      if (err) { dTotal.num.setValue('error'); setStatus('Error: ' + err); return; }
      var sign = function (x) { return (x >= 0 ? '+' : '') + fmt(x, 1); };
      var pct = function (x, base) { return base ? ' (' + (x >= 0 ? '+' : '') + fmt(100 * x / base, 0) + '%)' : ''; };
      var tot = r.dT + r.dG, base = r.t0 + r.g0;
      dTotal.num.setValue(sign(tot) + ' km²'); dTotal.num.style().set('color', tot >= 0 ? GREEN_TXT : RED_TXT);
      dTotal.cap.setValue('Net change in non-crop green' + pct(tot, base));
      dTrees.num.setValue(sign(r.dT) + ' km²'); dTrees.num.style().set('color', r.dT >= 0 ? GREEN_TXT : RED_TXT);
      dTrees.cap.setValue('Change in tree cover' + pct(r.dT, r.t0));
      dGrass.num.setValue(sign(r.dG) + ' km²'); dGrass.num.style().set('color', r.dG >= 0 ? GREEN_TXT : RED_TXT);
      dGrass.cap.setValue('Change in grass, lawns, parks' + pct(r.dG, r.g0));
      dSplit.num.setValue(fmt(r.up || 0, 0) + ' / ' + fmt(r.down || 0, 0) + ' km²');
      dSplit.cap.setValue('Land that gained / lost ≥ 10 points of green');
    });
}

var TIMELAPSE_PANEL = null;
function timelapsePanel() {
  if (TIMELAPSE_PANEL) return TIMELAPSE_PANEL;
  var p = ui.Panel(null, null, {margin: '4px 8px'});
  TIMELAPSE_PANEL = p;
  p.add(ui.Label('Timelapse: Lahore\u2019s green cover, 2019\u20132026', HEADING));
  // Earth Engine does not show images from outside links, so the finished GIF opens in a new tab and the
  // in-app animation is built on request; both sit at the top so they are visible without scrolling.
  if (TIMELAPSE_FULL_URL) {
    p.add(ui.Label('\u25b6 Watch the timelapse (opens in a new tab)', {fontSize: '15px', fontWeight: 'bold',
      color: COL.green, margin: '6px 8px'}, TIMELAPSE_FULL_URL));
  }
  p.add(ui.Panel([gifButton, ui.Label('or build it here from the map data (about 1\u20132 minutes)',
    {fontSize: '12px', color: '#555', margin: '13px 4px 0 4px'})], wrapRow(), {margin: '0 4px'}));
  p.add(gifHolder);
  p.add(ui.Label('2026* is provisional: the year is not complete yet. Numbers in the animation are the ' +
    'model\u2019s own estimates.', SMALL));
  return p;
}


// Results of the last full verification run (October 2026), shown in the public app instead of re-running
// the checks (3-10 minutes of computing per click). Set PUBLIC_MODE = false to run them live.
var SAVED_CHECKS = [
  ['C1', 'PASS', 'Clear images cover the whole city in every year'],
  ['C2', 'PASS', 'Tree share stays within 4.0 points in protected forest and stable canopy'],
  ['C3', 'WARN', 'Tree area about 9% below held-out 1 m canopy data (R² 0.41), mostly small trees'],
  ['C4', 'PASS', '51% of held-out park open land found as grass; 21% of cropland counted as grass; built-up 25% (lawns, info)'],
  ['C5', 'PASS', 'About 1% false change on land that cannot change'],
  ['C6', 'PASS', 'Change 2019→2025 stays between +6% and +14% across model settings'],
  ['C7', 'WARN', 'Three methods agree the cover rose, but disagree on how much (+13% to +76%)'],
  ['C8', 'PASS', 'Grass / crop classifier passes on held-out points'],
  ['C9', 'WARN', 'Total +5.0 km²/yr (95% CI −1.7 to +11.0); trees +1.0 km²/yr (CI −2.4 to +4.7): not yet established, as 7 years of data ' +
    '(2019–2025) is too short to prove a trend'],
  ['C10', 'PASS', 'NASA GEDI laser canopy heights agree with the tree change (r = 0.62)'],
  ['C11', 'PASS', '21.4 km² newly built 2019–2023 (Open Buildings); green fell on 77% of it, 1.7 km² lost'],
  ['D1', 'INFO', 'Diagnostic only (spread between the three tree models)'],
  ['D2', 'INFO', 'Green area follows rainfall (r = 0.62): part of the year-to-year change is weather']
];
var SAVED_AREAS = [   // [year, trees, grass] in km2 from the last full run; 2026 provisional
  [2019, 62.92, 213.66], [2020, 67.24, 219.62], [2021, 73.45, 227.47], [2022, 76.85, 231.89],
  [2023, 74.04, 230.18], [2024, 68.82, 226.95], [2025, 69.81, 242.08], [2026, 70.99, 249.93]];
var SAVED_SEN = 5.01;   // km2 per year, total non-crop green 2019-2025 (95% CI -1.72 to +10.95)
function savedTrendChart() {
  var t0 = SAVED_AREAS[0][0], complete = SAVED_AREAS.filter(function (a) { return !isProvisional(a[0]); });
  var resid = complete.map(function (a) { return a[1] + a[2] - SAVED_SEN * (a[0] - t0); }).sort(function (a, b) {
    return a - b; });
  var mid = Math.floor(resid.length / 2);
  var b = resid.length % 2 ? resid[mid] : (resid[mid - 1] + resid[mid]) / 2;   // Sen intercept: median residual
  var rows = [['Year', 'Total non-crop green', 'Grass, lawns, parks', 'Tree cover',
               'Trend 2019\u20132025 (Sen\u2019s slope)']];
  SAVED_AREAS.forEach(function (a) {
    rows.push([String(a[0]) + (isProvisional(a[0]) ? '*' : ''), a[1] + a[2], a[2], a[1],
               isProvisional(a[0]) ? null : Math.round((b + SAVED_SEN * (a[0] - t0)) * 10) / 10]);
  });
  return ui.Chart(rows, 'LineChart', {
    title: 'Non-crop green area (km\u00b2) \u00b7 trend +' + SAVED_SEN.toFixed(1) +
      ' km\u00b2/yr, not yet statistically significant (7 years is too short) \u00b7 2026* provisional',
    titleTextStyle: {fontSize: 12, bold: false, color: '#444'},
    colors: ['#1b7837', '#93c02c', '#0b5a2a', '#888888'],
    series: {0: {lineWidth: 3, pointSize: 6}, 1: {lineWidth: 2, pointSize: 4}, 2: {lineWidth: 2, pointSize: 4},
             3: {lineWidth: 2, pointSize: 0, lineDashStyle: [6, 4]}},
    vAxis: {title: 'km\u00b2', viewWindow: {min: 0}, gridlines: {color: '#eee'}},
    hAxis: {textStyle: {fontSize: 11}},
    legend: {position: 'bottom', textStyle: {fontSize: 11}},
    chartArea: {left: 55, right: 15, top: 40, bottom: 60},
    height: 340,
    interpolateNulls: false
  });
}

function showSavedChecks() {
  SAVED_CHECKS.forEach(function (c) { setRow(c[0], c[1], c[2]); });
  verdict.setValue('Model estimate: 276.6 km² (2019) → 311.9 km² (2025), +35.3 km². ' +
    'The direction is confirmed by independent data; report it as an estimate with caveats.');
}

var METHODS_PANEL = null;
function methodsPanel() {
  if (METHODS_PANEL) return METHODS_PANEL;
  var p = ui.Panel(null, null, {margin: '4px 8px'});
  METHODS_PANEL = p;
  p.add(ui.Label('How the map is made', HEADING));
  p.add(ui.Label(
    '• Images: Sentinel-2 satellite, 10 m pixels, three clear seasons each year (Feb–Mar, May–Jun, early Oct), ' +
    'clouds and haze removed.\n' +
    '• Trees: a machine-learning model estimates the share of every pixel covered by trees, trained on a ' +
    '1 m canopy-height map (Meta/WRI).\n' +
    '• Grass, lawns, parks: the share of each pixel that stays green all year and is not trees, with crops ' +
    'excluded; trained and tested with OpenStreetMap parks, lawns and golf courses.\n' +
    '• Crops are excluded on purpose: wheat and rice fields are green for a few months only.\n' +
    '• Drift between years is measured on land that cannot change (dense old built-up areas, permanent water) ' +
    'and removed.', PARA));
  p.add(ui.Label('How we checked it', HEADING));
  p.add(ui.Label('Ten scored checks test the model against data it was NOT trained on – held-out canopy ' +
    'samples, held-out OSM parks, land that cannot change – and two fully independent sources: NASA’s GEDI ' +
    'space laser and Google Open Buildings. Without field visits the best possible verdict is "well-supported", ' +
    'not "field-verified".' + (PUBLIC_MODE ? '' : ' Running all checks takes about 3–10 minutes.'), PARA));
  verdict.style().set({backgroundColor: '#fff6e5', border: '1px solid #f0d9a8', padding: '8px 10px'});
  p.add(verdict);
  if (PUBLIC_MODE) {
    p.add(ui.Label('Results of the last full run (October 2026):', PARA));
  } else {
    p.add(ui.Button({label: 'Run all checks', onClick: runAll}));
  }
  p.add(scorePanel);
  if (PUBLIC_MODE) {
    p.add(ui.Label('Year by year', HEADING));
    p.add(savedTrendChart());
  }
  p.add(detailHolder);
  if (PUBLIC_MODE) showSavedChecks();
  return p;
}

var ABOUT_PANEL = null;
function aboutPanel() {
  if (ABOUT_PANEL) return ABOUT_PANEL;
  var p = ui.Panel(null, null, {margin: '4px 8px'});
  ABOUT_PANEL = p;
  p.add(ui.Label('About this map', HEADING));
  p.add(ui.Label(
    'This app maps Lahore’s non-crop green cover – trees, grass, lawns, shrubs and parks – for every year ' +
    'from 2019 to 2026, and shows where it changed. It is a research estimate built from free satellite data, ' +
    'not an official statistic.', PARA));
  p.add(ui.Label('What to keep in mind', HEADING));
  p.add(ui.Label(
    '• 2026 is provisional: the year is not complete yet.\n' +
    '• Tree cover is under-estimated by roughly 9% of the tree area compared with 1 m canopy data, mainly very ' +
    'small trees (about 70 km² shown is really about 76 km²; a change of under half a percentage point of ' +
    'Lahore, not 9 points).\n' +
    '• Year-to-year changes are partly weather-related; the 2019–2025 increase is not yet a statistically ' +
    'proven trend, because 7 years of data is too short (details in "How We Know").\n' +
    '• Neighbourhood names are approximate reference points, not boundaries.\n' +
    '• The district outline is simplified (geoBoundaries).', PARA));
  p.add(ui.Label('Data sources', HEADING));
  p.add(ui.Label(
    '• ESA / Copernicus Sentinel-2 surface reflectance, with Google Cloud Score+ cloud masking\n' +
    '• Meta / World Resources Institute 1 m global canopy height\n' +
    '• OpenStreetMap contributors (parks, lawns, golf courses, forests) – ODbL\n' +
    '• Google Dynamic World, ESA WorldCover 2020 and 2021\n' +
    '• NASA GEDI canopy heights, Google Open Buildings 2.5D Temporal (independent checks)\n' +
    '• JRC Global Surface Water, GHSL population, CHIRPS rainfall\n' +
    '• District boundary: geoBoundaries', PARA));
  p.add(ui.Label('Download the data', HEADING));
  p.add(ui.Label('Exports the selected year as a GeoTIFF to your own Google Drive (requires an Earth Engine account).', SMALL));
  p.add(ui.Button({label: 'Export the selected year', onClick: exportYear}));
  p.add(exportMsg);
  return p;
}

map.onClick(function (coords) {
  if (mode === 'bench') { benchClick(coords); return; }
  if (mode !== 'year' && mode !== 'change') return;
  var pt = ee.Geometry.Point([coords.lon, coords.lat]);
  inspectLabel.setValue('Reading values…');
  if (mode === 'change') {
    var y0 = Number(chFrom.getValue()), y1 = Number(chTo.getValue());
    treeFrac(y0).rename('t0').addBands(treeFrac(y1).rename('t1'))
      .addBands(grassFrac(y0).rename('g0')).addBands(grassFrac(y1).rename('g1'))
      .reduceRegion({reducer: ee.Reducer.first(), geometry: pt, scale: 10}).evaluate(function (v) {
        if (!v || v.t0 === null || v.t0 === undefined) { inspectLabel.setValue('No data here.'); return; }
        inspectLabel.setValue('Near ' + nearestPlace(coords.lon, coords.lat) + '\n' +
          'Tree share   ' + y0 + ': ' + fmt(100 * v.t0, 0) + '%   ' + y1 + ': ' + fmt(100 * v.t1, 0) + '%\n' +
          'Grass share  ' + y0 + ': ' + fmt(100 * v.g0, 0) + '%   ' + y1 + ': ' + fmt(100 * v.g1, 0) + '%');
      });
    return;
  }
  var y = selectedYear;
  treeFrac(y).rename('tf').addBands(grassFrac(y)).addBands(background(y))
    .reduceRegion({reducer: ee.Reducer.first(), geometry: pt, scale: 10}).evaluate(function (v) {
      if (!v || v.tf === null || v.tf === undefined) { inspectLabel.setValue('No data here for ' + y + '.'); return; }
      var bgName = {3: 'crops / other', 4: 'built-up', 5: 'water', 6: 'bare ground'}[v.bg] || 'n/a';
      inspectLabel.setValue(y + ' · near ' + nearestPlace(coords.lon, coords.lat) + '\n' +
        'Tree cover: ' + fmt(100 * v.tf, 0) + '% of this 10 m spot · grass, lawns, parks: ' + fmt(100 * v.gfrac, 0) +
        '% · rest of the spot is mostly ' + bgName);
    });
});

// --- Lahore vs Benchmarks
// Benchmarks: 3-30-300 rule (30% tree canopy per neighbourhood; park within 300 m; Konijnendijk 2021-23),
// WHO/Europe 2016-17 (public green space of at least 0.5 ha within 300 m of every home) and the widely quoted
// 9 m2 minimum / 50 m2 ideal green space per resident.
var BM_RADIUS_KM = 3;     // a neighbourhood zone = built-up land given to the nearest named place (max 3 km)
// Built-up city: ESA WorldCover built-up within ~800 m (keeps parks and lawns inside the city, leaves out farmland)
// Built-up share on a fixed 100 m grid: cheap at every zoom level (computing the 800 m average from
// 10 m pixels made the zone tiles time out when zoomed in, leaving the map grey)
var WC_BUILT = ee.ImageCollection('ESA/WorldCover/v200').first().eq(50)
  .reduceResolution({reducer: ee.Reducer.mean(), maxPixels: 1024})
  .reproject(ee.Projection('EPSG:4326').atScale(100));
// city fabric (keeps parks inside the city) OR compact towns and villages surrounded by farmland
var BUILT_UP = WC_BUILT.focalMean(800, 'circle', 'meters').gte(0.12)
  .or(WC_BUILT.focalMean(250, 'circle', 'meters').gte(0.25));
var PARK_MIN_M2 = 5000;   // 0.5 ha
var POP_ID = 'JRC/GHSL/P2023A/GHS_POP/2025';
var BM_CLASSES = [5, 10, 20, 30];
var BM_PAL = ['#a50f15', '#fb6a4a', '#fcbba1', '#74c476', '#238b45'];
var bmYear = ui.Select({items: ALL_YEARS.map(String), placeholder: 'Year',
  onChange: function () { renderBenchmarks(); }, style: {margin: '6px 4px'}});
var bCanopy = makeCard('Tree canopy, share of the district', COL.red);
var bPerRes = makeCard('Non-crop green per resident', COL.green);
var bPark = makeCard('Residents within 300 m of a park');
var bZones = makeCard('Neighbourhoods meeting 30% canopy');
var bmList = ui.Label('', {fontSize: '12px', color: '#333', margin: '6px 0', whiteSpace: 'pre-wrap'});
var benchCards = ui.Panel([bCanopy.panel, bPerRes.panel, bPark.panel, bZones.panel, bmList], null, {margin: '0'});
ALL_CARDS.push(bCanopy, bPerRes, bPark, bZones);
var bmNote = ui.Label(
  'How to read this: every built-up part of the district (ESA WorldCover) \u2013 city, towns and villages \u2013 ' +
  'is given to its nearest named place (OpenStreetMap, up to ' + BM_RADIUS_KM + ' km away), so zones are ' +
  'approximate catchments, not official boundaries. Village zones are mapped but left out of the rankings ' +
  'and the neighbourhood count. Grey areas are farmland or open land. ' +
  'Parks are OpenStreetMap parks, gardens and recreation grounds of at least 0.5 ha; some may not be public. ' +
  'Residents are GHSL 2025 population estimates. Tree canopy is the model’s own figure. It under-counts the tree area ' +
  'by about 9% of itself (roughly 70 km² of trees is really about 76 km²), so the district’s canopy share ' +
  'rises by less than half a percentage point (about 4.1% to 4.5%), not by 9 points.', SMALL);

var ZONE_IMG = null;
function zoneImage() {
  if (ZONE_IMG) return ZONE_IMG;
  var ll = ee.Image.pixelLonLat();
  var r2 = Math.pow(BM_RADIUS_KM / 111, 2);
  ZONE_IMG = ee.ImageCollection(ZONE_PLACES.map(function (p, i) {
    var k = Math.cos(p[2] * Math.PI / 180);
    var dLon = BM_RADIUS_KM / (111 * k), dLat = BM_RADIUS_KM / 111;
    var box = ee.Geometry.Rectangle([p[1] - dLon, p[2] - dLat, p[1] + dLon, p[2] + dLat]);
    var d2 = ll.select('longitude').subtract(p[1]).multiply(k).pow(2)
      .add(ll.select('latitude').subtract(p[2]).pow(2));
    return d2.multiply(-1).rename('q').addBands(ee.Image.constant(i).toInt16().rename('zone'))
      .updateMask(d2.lte(r2)).clip(box);
  })).qualityMosaic('q').select('zone').updateMask(BUILT_UP)
    .reproject(ee.Projection('EPSG:4326').atScale(60)).clip(geom);   // fixed 60 m grid: same cost at every zoom
  return ZONE_IMG;
}
var PARKS = ee.FeatureCollection(OSM_ASSET).filter(ee.Filter.eq('category', 'park'))
  .map(function (f) { return f.set('a', f.geometry().area(1)); })
  .filter(ee.Filter.gte('a', PARK_MIN_M2));
function peopleImg() {
  var pop = ee.Image(POP_ID).select('population_count');
  // people per m2 on GHSL's own 100 m grid, times pixel area, so sums are right at any scale
  return pop.divide(ee.Image.pixelArea().reproject(pop.projection())).multiply(ee.Image.pixelArea()).rename('pop');
}
function nearParkImg() { return PARKS.distance(300).gte(0).unmask(0).clip(geom); }

function bmClass(pct) {
  for (var i = 0; i < BM_CLASSES.length; i++) if (pct < BM_CLASSES[i]) return i;
  return BM_CLASSES.length;
}
function bmLegend() {
  var p = ui.Panel(null, null, {padding: '6px 8px', backgroundColor: 'rgba(255,255,255,0.94)',
    width: IS_PHONE ? 'auto' : '230px'});
  p.add(ui.Label('Tree canopy by neighbourhood', {fontWeight: 'bold', fontSize: '12px', margin: '0 0 2px 0',
    backgroundColor: CLEAR}));
  ['under 5%', '5–10%', '10–20%', '20–30%', '30% or more (meets the target)'].forEach(function (t, i) {
    p.add(ui.Panel([
      ui.Label('', {backgroundColor: BM_PAL[i], padding: '6px 9px', margin: '3px 6px 0 0', border: '1px solid #888'}),
      ui.Label(t, {fontSize: '12px', margin: '3px 0 0 0', backgroundColor: CLEAR})
    ], ui.Panel.Layout.flow('horizontal'), {backgroundColor: CLEAR}));
  });
  p.add(ui.Panel([
    ui.Label('', {backgroundColor: '#d9d9d9', padding: '6px 9px', margin: '3px 6px 0 0', border: '1px solid #888'}),
    ui.Label('Grey: farmland or open land (not a neighbourhood)', {fontSize: '12px', margin: '3px 0 0 0',
      backgroundColor: CLEAR})
  ], ui.Panel.Layout.flow('horizontal'), {backgroundColor: CLEAR}));
  p.add(ui.Label('Green outlines: parks of 0.5 ha or more', {fontSize: '11px', color: '#666', margin: '4px 0 0 0',
    backgroundColor: CLEAR}));
  return p;
}

// Precomputed once (EXPORT_BENCH): zone map with one canopy-class band per year, and a table of
// per-zone and district totals. When both assets exist the tab loads in seconds; otherwise it computes live.
var BENCH_STATS_ASSET = ASSET_FOLDER + 'lahore_bench_stats';
var BENCH_ZONES_ASSET = ASSET_FOLDER + 'lahore_bench_zones';
// Published apps may not be allowed to list the asset folder, so each saved asset is looked up directly.
var BENCH_OK = false;
function checkBenchAssets() {
  ee.data.getAsset(BENCH_STATS_ASSET, function (a, e1) {
    if (e1 || !a) return;
    ee.data.getAsset(BENCH_ZONES_ASSET, function (b, e2) { BENCH_OK = !e2 && !!b; });
  });
}
function benchReady() { return BENCH_OK; }
function benchZoneLayer(y, ids, cls) {
  return benchReady() ? ee.Image(BENCH_ZONES_ASSET).select('c' + y).visualize({min: 0, max: 4, palette: BM_PAL})
                      : zoneImage().remap(ids, cls).visualize({min: 0, max: 4, palette: BM_PAL});
}

function exportBenchAssets() {
  var people = peopleImg(), near = people.multiply(nearParkImg()).rename('popNear');
  var zone = zoneImage();
  var here = ee.Geometry.Point([74.33, 31.55]);   // table rows need a geometry to be exported
  var feats = ee.FeatureCollection([]);
  var bands = [zone.rename('zone')];
  YEARS.forEach(function (y) {
    var stack = ee.Image.cat([treeAreaImg(y), greenAreaImg(y), AREA.rename('all'), people, near]).clip(geom);
    var tot = stack.reduceRegion({reducer: ee.Reducer.sum(), geometry: geom, scale: STAT_SCALE,
      maxPixels: 1e11, tileScale: 4});
    var groups = ee.List(stack.select(['trees', 'green', 'all', 'pop']).addBands(zone)
      .reduceRegion({reducer: ee.Reducer.sum().repeat(4).group({groupField: 4, groupName: 'zone'}),
        geometry: geom, scale: STAT_SCALE, maxPixels: 1e11, tileScale: 8}).get('groups'));
    var rows = ee.FeatureCollection(groups.map(function (g) {
      g = ee.Dictionary(g);
      var v = ee.List(g.get('sum'));
      var pct = ee.Number(v.get(0)).divide(v.get(2)).multiply(100);
      var cls = ee.List(BM_CLASSES).map(function (c) { return pct.gte(c); }).reduce(ee.Reducer.sum());
      return ee.Feature(here, {year: y, zone: g.get('zone'), trees: v.get(0), green: v.get(1), all: v.get(2),
        pop: v.get(3), cls: cls});
    }));
    feats = feats.merge(rows).merge(ee.FeatureCollection([ee.Feature(here, tot).set({year: y, zone: -1})]));
    bands.push(zone.remap(rows.aggregate_array('zone'), rows.aggregate_array('cls')).rename('c' + y));
  });
  Export.table.toAsset({collection: feats, description: 'lahore_bench_stats', assetId: BENCH_STATS_ASSET});
  Export.image.toAsset({image: ee.Image.cat(bands).toInt16(), description: 'lahore_bench_zones',
    assetId: BENCH_ZONES_ASSET, region: geom.bounds(), scale: 60, crs: 'EPSG:4326', maxPixels: 1e10});
  print('Benchmarks: open the Tasks tab and click RUN on lahore_bench_stats and lahore_bench_zones.');
}

var BM_CACHE = {};
var BM_ZONES = null;
function renderBenchmarks() {
  if (mode !== 'bench') return;
  var y = Number(bmYear.getValue());
  if (!has(y)) { setStatus('That year is not available.'); return; }
  styleNav();
  yearBadge.setValue(y + (isProvisional(y) ? ' (provisional)' : ''));
  sideTitle.setValue('Lahore vs benchmarks, ' + y);
  showLegend(bmLegend());
  if (BM_CACHE[y]) { showBenchmarks(y, BM_CACHE[y]); finishLoading(); return; }
  startLoading('Loading the benchmarks');
  BM_ZONES = null;
  var first = benchReady() ? [ui.Map.Layer(benchZoneLayer(y), {}, 'Tree canopy by neighbourhood ' + y, true, 0.8)] : [];
  map.layers().reset(first.concat([ui.Map.Layer(PARKS.style({color: '1b7837', fillColor: '00000000', width: 1}), {},
    'Parks of 0.5 ha or more (OpenStreetMap)')]).concat(contextLayers()));
  [bCanopy, bPerRes, bPark, bZones].forEach(function (c) { c.num.setValue('\u2026'); });
  if (benchReady()) {
    bmList.setValue('Loading\u2026');
    ee.FeatureCollection(BENCH_STATS_ASSET).filter(ee.Filter.eq('year', y)).evaluate(function (fc, err) {
      finishLoading();
      if (err) { bmList.setValue('Error: ' + err); return; }
      var r = {tot: null, zones: []};
      fc.features.forEach(function (f) {
        var q = f.properties;
        if (q.zone === -1) r.tot = q;
        else r.zones.push({zone: q.zone, sum: [q.trees, q.green, q.all, q.pop]});
      });
      BM_CACHE[y] = r;
      if (mode === 'bench' && Number(bmYear.getValue()) === y) showBenchmarks(y, r);
    });
    return;
  }
  bmList.setValue('Calculating (about 30\u201360 s the first time)\u2026');
  var stack = ee.Image.cat([treeAreaImg(y), greenAreaImg(y), AREA.rename('all'), peopleImg(),
                            peopleImg().multiply(nearParkImg()).rename('popNear')]).clip(geom);
  var tot = stack.reduceRegion({reducer: ee.Reducer.sum(), geometry: geom, scale: STAT_SCALE,
    maxPixels: 1e11, tileScale: 4});
  var zones = stack.select(['trees', 'green', 'all', 'pop']).addBands(zoneImage())
    .reduceRegion({reducer: ee.Reducer.sum().repeat(4).group({groupField: 4, groupName: 'zone'}),
      geometry: geom, scale: STAT_SCALE, maxPixels: 1e11, tileScale: 8});
  ee.Dictionary({tot: tot, zones: zones.get('groups')}).evaluate(function (r, err) {
    finishLoading();
    if (err) { bmList.setValue('Error: ' + err); return; }
    BM_CACHE[y] = r;
    if (mode === 'bench' && Number(bmYear.getValue()) === y) showBenchmarks(y, r);
  });
}

function showBenchmarks(y, r) {
  var t = r.tot;
  var canopy = 100 * t.trees / t.all, perRes = 1e6 * t.green / t.pop, near = 100 * t.popNear / t.pop;
  bCanopy.num.setValue(fmt(canopy, 1) + '%');
  bCanopy.num.style().set('color', canopy >= 30 ? GREEN_TXT : RED_TXT);
  bCanopy.cap.setValue('Tree canopy, share of the district · target 30% (3-30-300 rule). Includes farmland.');
  bPerRes.num.setValue(fmt(perRes, 0) + ' m²');
  bPerRes.num.style().set('color', perRes >= 9 ? GREEN_TXT : RED_TXT);
  bPerRes.cap.setValue('Non-crop green per resident · commonly quoted minimum 9 m², ideal 50 m²');
  bPark.num.setValue(fmt(near, 0) + '%');
  bPark.num.style().set('color', near >= 80 ? GREEN_TXT : near >= 50 ? '#a15c00' : RED_TXT);
  bPark.cap.setValue('Residents within 300 m of a park of 0.5 ha or more · benchmark: 100% (WHO/Europe)');
  BM_ZONES = {};
  var groups = r.zones || [];
  var rows = groups.map(function (g) {
    var s = g.sum;
    var z = {name: ZONE_PLACES[g.zone][0], canopy: 100 * s[0] / s[2], perRes: s[3] > 0 ? 1e6 * s[1] / s[3] : null,
      pop: s[3], village: g.zone >= PLACES.length};
    BM_ZONES[g.zone] = z;
    return z;
  });
  var hoods = rows.filter(function (z) { return !z.village; });
  var meet = hoods.filter(function (z) { return z.canopy >= 30; }).length;
  bZones.num.setValue(meet + ' of ' + hoods.length);
  bZones.num.style().set('color', meet ? GREEN_TXT : RED_TXT);
  bZones.cap.setValue('Neighbourhoods meeting 30% tree canopy');
  var byCanopy = hoods.slice().sort(function (a, b) { return b.canopy - a.canopy; });
  var line = function (z) { return '  ' + z.name + ': ' + fmt(z.canopy, 1) + '%'; };
  var lowGreen = hoods.filter(function (z) { return z.pop > 20000 && z.perRes !== null && z.perRes < 9; }).length;
  bmList.setValue('Most tree canopy\n' + byCanopy.slice(0, 5).map(line).join('\n') +
    '\n\nLeast tree canopy\n' + byCanopy.slice(-5).reverse().map(line).join('\n') +
    '\n\nNeighbourhoods over 20,000 residents with less than 9 m² of green per resident: ' + lowGreen);
  var ids = groups.map(function (g) { return g.zone; });
  var cls = rows.map(function (z) { return bmClass(z.canopy); });
  var zoneLayer = benchZoneLayer(y, ids, cls);
  map.layers().reset([ui.Map.Layer(zoneLayer, {}, 'Tree canopy by neighbourhood ' + y, true, 0.8),
    ui.Map.Layer(PARKS.style({color: '1b7837', fillColor: '00000000', width: 1}), {}, 'Parks of 0.5 ha or more'),
    ui.Map.Layer(nearParkImg().selfMask(), {palette: ['#1b7837']}, 'Within 300 m of a park', false, 0.35)]
    .concat(contextLayers()));
}

function benchClick(coords) {
  if (!BM_ZONES) return;
  inspectLabel.setValue('Reading values\u2026');
  (benchReady() ? ee.Image(BENCH_ZONES_ASSET).select('zone') : zoneImage())
    .reduceRegion({reducer: ee.Reducer.first(), geometry: ee.Geometry.Point([coords.lon, coords.lat]),
    scale: 30}).evaluate(function (v) {
    var z = v && v.zone !== null && v.zone !== undefined ? BM_ZONES[v.zone] : null;
    if (!z) {
      inspectLabel.setValue('Not in a zone: farmland or open land.');
      return;
    }
    inspectLabel.setValue(z.name + (z.village ? ' (village)' : '') + ' zone\n' +
      'Tree canopy: ' + fmt(z.canopy, 1) + '% (target 30%)\n' +
      'Non-crop green per resident: ' + (z.perRes === null ? 'n/a' : fmt(z.perRes, 0) + ' m\u00b2 (minimum 9)') +
      '\nResidents (GHSL 2025): about ' + fmt(z.pop / 1000, 0) + ' thousand');
  });
}

// --- Phone / desktop layout
var LAYOUT_SET = false;
function applyLayout(isPhone) {
  if (LAYOUT_SET && isPhone === IS_PHONE) return;
  LAYOUT_SET = true;
  IS_PHONE = isPhone;
  map.style().set('height', isPhone ? '380px' : MAP_HEIGHT);
  map.setControlVisibility({zoomControl: true, scaleControl: !isPhone, mapTypeControl: !isPhone,
    layerList: !isPhone, fullscreenControl: !isPhone, drawingToolsControl: false});
  titleLabel.style().set('fontSize', isPhone ? '17px' : '22px');
  subtitleLabel.style().set('fontSize', isPhone ? '11px' : '13px');
  bylineLabel.style().set('fontSize', isPhone ? '11px' : '12px');
  navLabels.forEach(function (l) { l.style().set('width', isPhone ? '84px' : '110px'); });
  // phones: map on top, statistics below it two per row; desktop: statistics in a column on the right
  mapRow.setLayout(ui.Panel.Layout.flow(isPhone ? 'vertical' : 'horizontal'));
  sidePanel.style().set({width: isPhone ? 'auto' : '270px', stretch: isPhone ? 'horizontal' : 'vertical',
    margin: isPhone ? '6px 8px' : '0 8px 0 0'});
  [yearCards, changeCards, benchCards].forEach(function (p) {
    p.setLayout(isPhone ? wrapRow() : ui.Panel.Layout.flow('vertical'));
  });
  ALL_CARDS.forEach(function (c) {
    c.panel.style().set({width: isPhone ? '44%' : 'auto', margin: isPhone ? '4px 4px' : '4px 0',
      padding: isPhone ? '6px 8px' : '8px 12px'});
    c.num.style().set('fontSize', isPhone ? '18px' : '24px');
  });
  if (mode === 'year' || mode === 'change' || mode === 'bench') setMode(mode);   // re-place the legend
}
try {
  ui.root.onResize(function (info) { applyLayout(info.width < 700); });
} catch (e) { /* older editors: keep the desktop layout */ }

// Backwards-compatible entry point used by the checks (e.g. clicking a year on a chart).
function showYear(y) { selectedYear = y; setMode('year'); }

// ---------------------------------------------------------------------
// 7. VERIFICATION
// ---------------------------------------------------------------------
var RESULT = {};
var ICON = {PASS: '✅ PASS', WARN: '⚠️ WARN', FAIL: '❌ FAIL', ERROR: '❗ ERROR',
            RUN: '⏳ running', INFO: 'ℹ️ info'};
function setRow(id, st, text) {
  scoreRows[id].status.setValue(ICON[st] || st);
  scoreRows[id].detail.setValue(text || '');
  RESULT[id] = {status: st, text: text};
}
function addDetail(titleText, widget) {
  detailHolder.add(ui.Label(titleText, {fontWeight: 'bold', fontSize: '13px', margin: '10px 8px 2px 8px'}));
  detailHolder.add(widget);
}
function fail(id, err, next) { setRow(id, 'ERROR', String(err)); if (next) next(); }
function sumOpts(scale) {
  return {reducer: ee.Reducer.sum(), geometry: geom, scale: scale || STAT_SCALE, maxPixels: 1e11, tileScale: 4};
}
function trendYears() {
  return YEARS.filter(function (y) { return !isProvisional(y) && !(RESULT.yearFail && RESULT.yearFail[y]); });
}
var osm = ee.FeatureCollection(OSM_ASSET).randomColumn('r', 7);   // same split as Script A
var osmTestGrass = osm.filter(ee.Filter.inList('category', ['park', 'grass', 'golf', 'shrub']))
  .filter(ee.Filter.gte('r', 0.7));
var osmForest = osm.filter(ee.Filter.eq('category', 'tree'));

// C1 - share of the city with >= 4 clear looks in every season
function runC1(next) {
  setRow('C1', 'RUN');
  var bands = [];
  YEARS.forEach(function (y) {
    var n = img(y).select(['n1', 'n2', 'n3']);
    bands.push(n.select('n1').gte(4).rename('a' + y), n.select('n2').gte(4).rename('b' + y),
               n.select('n3').gte(4).rename('c' + y));
  });
  ee.Image.cat(bands).unmask(0).clip(geom).reduceRegion({reducer: ee.Reducer.mean(), geometry: geom,
    scale: 60, maxPixels: 1e10, tileScale: 4}).evaluate(function (r, err) {
    if (err) return fail('C1', err, next);
    var worst = 'PASS', lines = ['Year   Feb-Mar  May-Jun  Oct     status'];
    RESULT.yearFail = {};
    YEARS.forEach(function (y) {
      var v = [r['a' + y], r['b' + y], r['c' + y]].map(function (x) { return x || 0; });
      var mn = Math.min.apply(null, v);
      var st = mn >= 0.9 ? 'PASS' : mn >= 0.75 ? 'WARN' : 'FAIL';
      if (st === 'FAIL') RESULT.yearFail[y] = true;
      if (!isProvisional(y)) worst = st === 'FAIL' ? 'FAIL' : (st === 'WARN' && worst === 'PASS' ? 'WARN' : worst);
      lines.push(y + '   ' + v.map(function (x) { return (fmt(100 * x, 0) + '%      ').slice(0, 9); }).join('') +
        st + (isProvisional(y) ? ' (provisional)' : ''));
    });
    setRow('C1', worst, worst === 'PASS' ? '≥ 90% of the city well observed in every season' :
      'parts of the city poorly observed in some seasons');
    addDetail('C1 – share of Lahore with ≥ 4 clear looks per season', ui.Label(lines.join('\n'), MONO));
    if (next) next();
  });
}

// C9 (+ D1) - areas, trend, confidence interval, model spread
function runC9(next) {
  setRow('C9', 'RUN'); setRow('D1', 'RUN');
  var bands = [];
  YEARS.forEach(function (y) {
    bands.push(greenAreaImg(y).rename('g' + y), treeAreaImg(y).rename('t' + y), grassAreaImg(y).rename('s' + y));
    for (var k = 0; k < 3; k++) bands.push(treeAreaImg(y, {band: 'tf' + k}).rename('m' + k + '_' + y));
  });
  ee.Image.cat(bands).clip(geom).reduceRegion(sumOpts()).evaluate(function (r, err) {
    if (err) { setRow('D1', 'ERROR'); return fail('C9', err, next); }
    var rows = [], worst = 0;
    YEARS.forEach(function (y) {
      var mem = [0, 1, 2].map(function (k) { return r['m' + k + '_' + y] || 0; });
      var mean = (mem[0] + mem[1] + mem[2]) / 3;
      if (!isProvisional(y) && mean) worst = Math.max(worst, (Math.max.apply(null, mem) - Math.min.apply(null, mem)) / mean);
      rows.push({year: y, green: r['g' + y] || 0, trees: r['t' + y] || 0, grass: r['s' + y] || 0});
    });
    RESULT.areas = rows;
    var ty = trendYears(), use = rows.filter(function (x) { return ty.indexOf(x.year) >= 0; });
    var xs = use.map(function (x) { return x.year; });
    var mk = mannKendallSen(xs, use.map(function (x) { return x.green; }));
    var ci = senCI(xs, use.map(function (x) { return x.green; }));
    var mkT = mannKendallSen(xs, use.map(function (x) { return x.trees; }));
    var ciT = senCI(xs, use.map(function (x) { return x.trees; }));
    var mkG = mannKendallSen(xs, use.map(function (x) { return x.grass; }));
    var ciG = senCI(xs, use.map(function (x) { return x.grass; }));
    RESULT.trend = mk; RESULT.ci = ci;
    RESULT.trendT = mkT; RESULT.ciT = ciT; RESULT.trendG = mkG; RESULT.ciG = ciG;
    var est = function (c) { return c.lo > 0 ? 'increase established' : c.hi < 0 ? 'decrease established' : 'not established'; };
    var anyEst = function (c) { return c.lo > 0 || c.hi < 0; };
    setRow('C9', anyEst(ci) ? 'PASS' : anyEst(ciT) ? 'WARN' : 'WARN',
      'trees ' + fmt(mkT.sen, 2) + ' km²/yr (CI ' + fmt(ciT.lo, 2) + ' to ' + fmt(ciT.hi, 2) + ') ' + est(ciT) +
      '; total ' + fmt(mk.sen, 2) + ' (CI ' + fmt(ci.lo, 2) + ' to ' + fmt(ci.hi, 2) + ') ' + est(ci));
    setRow('D1', 'INFO', 'largest spread between the 3 tree models: ' + fmt(100 * worst, 0) + '%');
    var dt = {cols: [{id: 'y', label: 'Year', type: 'number'}, {id: 'g', label: 'Total non-crop green', type: 'number'},
                     {id: 't', label: 'Tree cover', type: 'number'}, {id: 's', label: 'Grass, lawns, parks', type: 'number'}],
      rows: rows.map(function (x) { return {c: [{v: x.year}, {v: x.green}, {v: x.trees}, {v: x.grass}]}; })};
    var chart = ui.Chart(dt, 'LineChart', {title: 'Non-crop green cover per year (km²)', height: 280,
      hAxis: {format: '####'}, vAxis: {title: 'km²'}, pointSize: 5, legend: {position: 'bottom'},
      colors: ['#000000', '#006d2c', '#b8e186']});
    chart.onClick(function (x) { if (x && has(Number(x))) showYear(Number(x)); });
    var lines = rows.map(function (x) {
      return x.year + '  total ' + fmt(x.green, 1) + '  trees ' + fmt(x.trees, 1) + '  grass ' + fmt(x.grass, 1) +
        ' km²' + (isProvisional(x.year) ? '  provisional' : '') +
        (RESULT.yearFail && RESULT.yearFail[x.year] ? '  excluded (C1)' : '');
    });
    lines.push('', 'Trend on ' + xs.join(', ') + ':',
      '  Total: Sen ' + fmt(mk.sen, 2) + ' km²/yr, 95% CI ' + fmt(ci.lo, 2) + ' to ' + fmt(ci.hi, 2) + ', MK p = ' + fmt(mk.p, 3),
      '  Trees: Sen ' + fmt(mkT.sen, 2) + ' km²/yr, 95% CI ' + fmt(ciT.lo, 2) + ' to ' + fmt(ciT.hi, 2) + ', MK p = ' + fmt(mkT.p, 3),
      '  Grass: Sen ' + fmt(mkG.sen, 2) + ' km²/yr, 95% CI ' + fmt(ciG.lo, 2) + ' to ' + fmt(ciG.hi, 2) + ', MK p = ' + fmt(mkG.p, 3),
      'A trend is "established" when its whole 95% confidence interval is on one side of zero.');
    addDetail('C9 – areas, trend and confidence interval', ui.Panel([chart, ui.Label(lines.join('\n'), MONO)]));
    if (next) next();
  });
}

// C2 - tree fraction should be stable in protected forests and stable canopy
function runC2(next) {
  setRow('C2', 'RUN');
  var stable = ee.Image().byte().paint(osmForest, 1).unmask(0)
    .or(WC2020.eq(10).and(worldCover.eq(10)));
  var bands = YEARS.map(function (y) { return treeFrac(y, {smooth: false}).updateMask(stable).rename('f' + y); });
  ee.Image.cat(bands).clip(geom).reduceRegion({reducer: ee.Reducer.mean(), geometry: geom, scale: 30,
    maxPixels: 1e10, tileScale: 4}).evaluate(function (r, err) {
    if (err) return fail('C2', err, next);
    var ys = trendYears().filter(function (y) { return r['f' + y] !== null && r['f' + y] !== undefined; });
    var v = ys.map(function (y) { return r['f' + y]; });
    var range = v.length ? Math.max.apply(null, v) - Math.min.apply(null, v) : NaN;
    setRow('C2', range <= 0.05 ? 'PASS' : range <= 0.10 ? 'WARN' : 'FAIL',
      'mean tree cover in stable canopy varies by ' + fmt(100 * range, 1) + ' points (PASS ≤ 5)');
    addDetail('C2 – tree cover in protected forests + stable canopy', ui.Label(YEARS.map(function (y) {
      return y + '   ' + fmt(100 * r['f' + y], 1) + '%';
    }).join('\n'), MONO));
    if (next) next();
  });
}

// C3 - tree fraction vs held-out 1 m canopy samples (fold 0, never trained on)
function runC3(next) {
  setRow('C3', 'RUN');
  if (!has(TRAIN_YEAR)) return fail('C3', 'asset for ' + TRAIN_YEAR + ' missing', next);
  var test = ee.FeatureCollection(ASSET_FOLDER + 'lahore_v7_tree_samples').filter(ee.Filter.eq('fold', 0));
  var pred = treeFrac(TRAIN_YEAR, {smooth: false}).rename('pred').reduceRegions({collection: test, reducer: ee.Reducer.mean().setOutputs(['pred']),
    scale: 10, tileScale: 4}).filter(ee.Filter.notNull(['pred']));
  pred.reduceColumns(ee.Reducer.toList(2), ['treefrac', 'pred']).get('list').evaluate(function (rows, err) {
    if (err) return fail('C3', err, next);
    var n = rows.length, sr = 0, sp = 0, sae = 0;
    rows.forEach(function (x) { sr += x[0]; sp += x[1]; sae += Math.abs(x[1] - x[0]); });
    var mr = sr / n, ssr = 0, sst = 0;
    rows.forEach(function (x) { ssr += (x[1] - x[0]) * (x[1] - x[0]); sst += (x[0] - mr) * (x[0] - mr); });
    var bias = sr ? sp / sr - 1 : NaN, r2 = sst ? 1 - ssr / sst : NaN, mae = sae / n;
    var st = Math.abs(bias) <= 0.10 && r2 >= 0.5 ? 'PASS' : Math.abs(bias) <= 0.20 && r2 >= 0.3 ? 'WARN' : 'FAIL';
    RESULT.c3 = {bias: bias, scale: sp ? sr / sp : NaN};
    setRow('C3', st, 'total tree cover ' + (bias >= 0 ? 'over' : 'under') + '-estimated by ' + fmt(100 * Math.abs(bias), 0) +
      '%; R² ' + fmt(r2, 2) + '; mean error ' + fmt(100 * mae, 0) + ' points (' + n + ' held-out pixels)');
    addDetail('C3 – tree fraction vs held-out 1 m canopy heights (' + TRAIN_YEAR + ')', ui.Label(
      'Held-out pixels: ' + n + ' (spatial fold 0, never used for training)\n' +
      'Reference mean tree cover: ' + fmt(100 * sr / n, 1) + '%   model mean: ' + fmt(100 * sp / n, 1) + '%\n' +
      'Bias in total: ' + pctTxt(100 * bias) + '   R²: ' + fmt(r2, 2) + '   mean absolute error: ' + fmt(100 * mae, 1) + ' points\n' +
      'PASS: bias within ±10% and R² ≥ 0.5. This directly answers "over- or under-counting trees?".\n' +
      'Caveat: the canopy map’s own errors and imagery dates (mostly 2018–2020) carry into this test.', MONO));
    if (next) next();
  });
}

// C4 - grass: recall in held-out OSM parks, false grass in crops / built-up; tunes GRASS_CUT
function runC4Binary(next) {
  setRow('C4', 'RUN');
  var y = lastComplete();
  var i = img(y);
  var probe = grassProb(y).rename('grassp').addBands(i.select('cropp').divide(1000))
    .addBands(treeFrac(y).rename('tf'));
  var parkPts = ee.Image(1).clipToCollection(osmTestGrass).selfMask().addBands(probe)
    .sample({region: osmTestGrass.geometry(), scale: 10, numPixels: 3000, seed: 8, tileScale: 4, geometries: false});
  var a = i.select('dwarg');
  var refBg = ee.Image(0)
    .where(WC2020.eq(40).and(worldCover.eq(40)).and(a.eq(4)), 3)
    .where(WC2020.eq(50).and(worldCover.eq(50)).and(a.eq(6)), 4)
    .selfMask().rename('ref');
  var bgPts = refBg.addBands(probe).clip(geom).stratifiedSample({numPoints: 1000, classBand: 'ref', region: geom,
    scale: 10, seed: 9, tileScale: 4, classValues: [3, 4], classPoints: [1000, 1000]});
  var bgAreas = AREA.addBands(refBg).reduceRegion({reducer: ee.Reducer.sum().group({groupField: 1, groupName: 'c'}),
    geometry: geom, scale: STAT_SCALE, maxPixels: 1e11, tileScale: 4}).get('groups');
  var CUTS = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
  var mapped = ee.Image.cat(CUTS.map(function (c, k) {
    return grassAreaImg(y, {cut: c}).rename('c' + k);
  })).clip(geom).reduceRegion(sumOpts());
  ee.Dictionary({park: parkPts.reduceColumns(ee.Reducer.toList(3), ['grassp', 'cropp', 'tf']).get('list'),
                 bg: bgPts.reduceColumns(ee.Reducer.toList(4), ['ref', 'grassp', 'cropp', 'tf']).get('list'),
                 areas: bgAreas, mapped: mapped})
  .evaluate(function (r, err) {
    if (err) return fail('C4', err, next);
    var W = {};
    (r.areas || []).forEach(function (g) { W[g.c] = g.sum; });
    var isG = function (gp, cp, tf, cut) {
      var c = cutFor(y, cut, GRASS_QMATCH);          // same year-matched cut-off as the map
      return gp >= c && gp > cp && tf < MAX_TREE_UNDER_GRASS;
    };
    var table = CUTS.map(function (cut, k) {
      var nonTree = r.park.filter(function (p) { return p[2] < MAX_TREE_UNDER_GRASS; });
      var rec = nonTree.length ? nonTree.filter(function (p) { return isG(p[0], p[1], p[2], cut); }).length / nonTree.length : NaN;
      // False grass is scored against CROPS only. Grass inside 'built-up' reference pixels is
      // reported separately: WorldCover / Dynamic World call gardens and lawns 'built-up' at 10 m.
      var areaFor = function (c) {
        var pts = r.bg.filter(function (p) { return p[0] === c; });
        var rate = pts.length ? pts.filter(function (p) { return isG(p[1], p[2], p[3], cut); }).length / pts.length : 0;
        return rate * (W[c] || 0);
      };
      var m = r.mapped['c' + k] || 0;
      return {cut: cut, recall: rec, mapped: m,
              fpShare: m ? Math.min(1, areaFor(3) / m) : NaN,
              builtShare: m ? Math.min(1, areaFor(4) / m) : NaN};
    });
    var ok = table.filter(function (t) { return t.fpShare <= 0.25; });
    var meets = ok.length > 0;
    var best = meets ? ok.reduce(function (a, b) { return b.recall > a.recall ? b : a; }) :
      table.filter(function (t) { return !isNaN(t.fpShare); })
        .reduce(function (a, b) { return b.fpShare < a.fpShare ? b : a; }, table[table.length - 1]);
    var before = GRASS_CUT, applied = false;
    if (AUTO_TUNE_GRASS && best && best.cut !== GRASS_CUT) {
      GRASS_CUT = best.cut;                       // every later check and the map use the tuned cut
      applied = true;
      if (selectedYear) showYear(selectedYear);
    }
    var cur = table.filter(function (t) { return Math.abs(t.cut - GRASS_CUT) < 1e-9; })[0] || table[2];
    var st = cur.recall >= 0.6 && cur.fpShare <= 0.25 ? 'PASS' : cur.recall >= 0.4 && cur.fpShare <= 0.4 ? 'WARN' : 'FAIL';
    setRow('C4', st, 'cut ' + GRASS_CUT + (applied ? ' (auto-tuned from ' + before + ')' : '') + ': finds ' +
      fmt(100 * cur.recall, 0) + '% of held-out OSM grass; ~' + fmt(100 * cur.fpShare, 0) +
      '% of mapped grass may be crops; ~' + fmt(100 * cur.builtShare, 0) + '% lies in built-up areas (lawns?)');
    addDetail('C4 – grass detection in ' + y, ui.Label(
      'cut   finds OSM grass   mapped grass   possibly crops   in built-up (lawns?)\n' +
      table.map(function (t) {
        return fmt(t.cut, 1) + '   ' + (fmt(100 * t.recall, 0) + '%              ').slice(0, 18) +
          (fmt(t.mapped, 1) + ' km²       ').slice(0, 15) + (fmt(100 * t.fpShare, 0) + '%              ').slice(0, 17) +
          fmt(100 * t.builtShare, 0) + '%' +
          (Math.abs(t.cut - GRASS_CUT) < 1e-9 ? '   ← in use' : '');
      }).join('\n') +
      '\nRule: use the cut that finds the most held-out OSM grass while keeping grass that may be' +
      '\ncrops at or below 25%.' + (meets ? '' : ' No cut meets this, so the one with the least possible crop grass is used.') +
      '\n"In built-up" is information only: reference maps label gardens and lawns as built-up at 10 m.' +
      '\nHeld-out OSM parks were never used for training. OSM parks also contain paths and buildings,' +
      '\nso 100% is not expected.', MONO));
    if (next) next();
  });
}

// C4 - grass share: held-out OSM parks should be largely grass; little grass in cropland
function runC4(next) {
  if (grassMethod() === 'binary') return runC4Binary(next);
  setRow('C4', 'RUN');
  var y = lastComplete(), a = img(y).select('dwarg');
  var parks = ee.Image().byte().paint(osmTestGrass, 1).unmask(0).eq(1);
  var cropRef = WC2020.eq(40).and(worldCover.eq(40)).and(a.eq(4));
  var builtRef = WC2020.eq(50).and(worldCover.eq(50)).and(a.eq(6));
  var g = grassAreaImg(y);
  var open = ee.Image(1).subtract(treeFrac(y)).multiply(AREA);
  ee.Image.cat([g.updateMask(parks).rename('gPark'), open.updateMask(parks).rename('oPark'),
                g.updateMask(cropRef).rename('gCrop'), g.updateMask(builtRef).rename('gBuilt'), g.rename('gAll')])
    .clip(geom).reduceRegion(sumOpts(10)).evaluate(function (r, err) {
      if (err) return fail('C4', err, next);
      var parkShare = r.oPark ? r.gPark / r.oPark : NaN;
      var cropShare = r.gAll ? r.gCrop / r.gAll : NaN;
      var builtShare = r.gAll ? r.gBuilt / r.gAll : NaN;
      var st = parkShare >= 0.4 && cropShare <= 0.25 ? 'PASS' :
               parkShare >= 0.25 && cropShare <= 0.4 ? 'WARN' : 'FAIL';
      setRow('C4', st, 'held-out OSM parks: ' + fmt(100 * parkShare, 0) + '% of open land counted as grass; ' +
        fmt(100 * cropShare, 0) + '% of all grass lies in cropland; ' + fmt(100 * builtShare, 0) +
        '% in built-up areas (lawns?)');
      addDetail('C4 – grass share in ' + y, ui.Label(
        'Held-out OSM parks (never used for training): ' + fmt(r.oPark, 2) + ' km² of open (non-tree) land,\n' +
        '  of which ' + fmt(r.gPark, 2) + ' km² (' + fmt(100 * parkShare, 0) + '%) is counted as grass.\n' +
        'All mapped grass: ' + fmt(r.gAll, 1) + ' km²; in confirmed cropland ' + fmt(r.gCrop, 1) + ' km² (' +
        fmt(100 * cropShare, 0) + '%); in built-up ' + fmt(r.gBuilt, 1) + ' km² (' + fmt(100 * builtShare, 0) + '%).\n' +
        'PASS: ≥ 40% of open park land counted as grass and ≤ 25% of grass in cropland.\n' +
        'OSM parks include paths, courts and buildings, so 100% is not expected. Grass in built-up areas is\n' +
        'information only: reference maps label gardens and lawns as built-up at 10 m.', MONO));
      if (next) next();
    });
}

// C5 - false change on invariant land (dense built cores + permanent water)
function runC5(next) {
  setRow('C5', 'RUN');
  var y0 = firstYear(), y1 = lastComplete();
  var inv = INV_TEST;   // the half NOT used to measure drift
  var dT = treeAreaImg(y1).subtract(treeAreaImg(y0));
  var dG = grassAreaImg(y1).subtract(grassAreaImg(y0));
  ee.Image.cat([dT.updateMask(inv).rename('tInv'), dG.updateMask(inv).rename('gInv'),
                AREA.updateMask(inv).rename('aInv'), dT.rename('tAll'), dG.rename('gAll'), AREA.rename('aAll')])
  .clip(geom).reduceRegion(sumOpts())
  .evaluate(function (r, err) {
    if (err) return fail('C5', err, next);
    var scale = r.aInv ? r.aAll / r.aInv : NaN;          // extrapolate test-land change to the whole district
    var spT = r.tInv * scale, spG = r.gInv * scale;
    var spurious = spT + spG, observed = r.tAll + r.gAll;
    var ratio = observed ? Math.abs(spurious / observed) : NaN;
    var st = Math.abs(observed) < 1 ? 'WARN' : ratio < 0.25 ? 'PASS' : ratio < 0.5 ? 'WARN' : 'FAIL';
    RESULT.c5 = {spT: spT, spG: spG};
    setRow('C5', st, 'observed net change ' + fmt(observed, 1) + ' km²; possible artefact ~' + fmt(spurious, 1) +
      ' km² (' + fmt(100 * ratio, 0) + '%): trees ' + fmt(spT, 1) + ', grass ' + fmt(spG, 1));
    var row = function (name, test, all, sp) {
      return (name + '        ').slice(0, 8) + 'on test land ' + (fmt(test, 3) + ' km²       ').slice(0, 15) +
        '→ district-wide artefact ~' + (fmt(sp, 1) + ' km²      ').slice(0, 12) + ' observed ' + fmt(all, 1) +
        ' km² (' + fmt(all ? 100 * Math.abs(sp / all) : NaN, 0) + '%)';
    };
    addDetail('C5 – false change ' + y0 + ' → ' + y1 + ' (split into trees and grass)', ui.Label(
      'Test half of unchanging land (not used for drift correction): ' + fmt(r.aInv, 1) + ' km² of ' +
        fmt(r.aAll, 0) + ' km²\n' +
      row('Trees', r.tInv, r.tAll, spT) + '\n' + row('Grass', r.gInv, r.gAll, spG) + '\n' +
      'PASS if the total possible artefact is < 25% of the observed change.\n' +
      'This is a strict test: it scales change on a small area of dense built-up cores up to the\n' +
      'whole district, so real greening there (road-side planting, small parks) also counts as "artefact".', MONO));
    if (next) next();
  });
}

// C6 - robustness to settings
function runC6(next) {
  setRow('C6', 'RUN');
  var y0 = firstYear(), y1 = lastComplete();
  var V = [['Default', {}], ['No year-averaging', {smooth: false}],
           ['No drift correction', {drift: false}],
           ['Tree floor 5%', {floor: 0.05}],
           ['Green end-points narrower', {soil: FVC_SOIL + 0.03, veg: FVC_VEG - 0.05}],
           ['Green end-points wider', {soil: FVC_SOIL - 0.03, veg: FVC_VEG + 0.05}],
           ['Tree model 1 only', {band: 'tf0'}], ['Tree model 2 only', {band: 'tf1'}], ['Tree model 3 only', {band: 'tf2'}]];
  // For reference only (not scored): the old yes/no grass method that flickered.
  var REF = [['(old yes/no grass, not scored)', {grassMethod: 'binary'}]];
  var bands = [];
  var ALL = V.concat(REF);
  ALL.forEach(function (v, i) {
    bands.push(greenAreaImg(y0, v[1]).rename('a' + i), greenAreaImg(y1, v[1]).rename('b' + i));
  });
  ee.Image.cat(bands).clip(geom).reduceRegion(sumOpts()).evaluate(function (r, err) {
    if (err) return fail('C6', err, next);
    var chAll = ALL.map(function (v, i) { return r['a' + i] ? 100 * (r['b' + i] - r['a' + i]) / r['a' + i] : 0; });
    var ch = chAll.slice(0, V.length);
    var same = ch.every(function (c) { return c > 0; }) || ch.every(function (c) { return c < 0; });
    var flat = ch.every(function (c) { return Math.abs(c) <= 5; });   // all settings agree: no real change
    var spread = Math.max.apply(null, ch) - Math.min.apply(null, ch);
    setRow('C6', (same || flat) && spread <= 30 ? 'PASS' : same ? 'WARN' : 'FAIL',
      (flat ? 'all settings agree: little or no change' : same ? 'same direction' : 'direction CHANGES with settings') +
      ', change ' + pctTxt(Math.min.apply(null, ch)) + ' to ' + pctTxt(Math.max.apply(null, ch)));
    addDetail('C6 – change ' + y0 + ' → ' + y1 + ' under different settings', ui.Label(ALL.map(function (v, i) {
      return (v[0] + '                                  ').slice(0, 34) + fmt(r['a' + i], 1) + ' → ' +
        fmt(r['b' + i], 1) + ' km²  (' + pctTxt(chAll[i]) + ')';
    }).join('\n') + '\nPASS: all settings give the same direction (or all within ±5%), spread ≤ 30 points.', MONO));
    if (next) next();
  });
}

// C7 - three methods agree on direction
function runC7(next) {
  setRow('C7', 'RUN');
  var y0 = firstYear(), y1 = lastComplete();
  ee.Image.cat([
    greenAreaImg(y0).rename('m0'), greenAreaImg(y1).rename('m1'),
    AREA.updateMask(dwGreen(y0)).rename('d0'), AREA.updateMask(dwGreen(y1)).rename('d1'),
    AREA.updateMask(ruleGreen(y0)).rename('r0'), AREA.updateMask(ruleGreen(y1)).rename('r1')
  ]).clip(geom).reduceRegion(sumOpts()).evaluate(function (r, err) {
    if (err) return fail('C7', err, next);
    var M = [['This model (v7)', r.m0, r.m1], ['Dynamic World only', r.d0, r.d1], ['Rule-based (v4)', r.r0, r.r1]];
    var ch = M.map(function (x) { return x[1] ? 100 * (x[2] - x[1]) / x[1] : 0; });
    var same = ch.every(function (c) { return c > 0; }) || ch.every(function (c) { return c < 0; });
    var spread = Math.max.apply(null, ch) - Math.min.apply(null, ch);
    setRow('C7', same && spread <= 30 ? 'PASS' : same ? 'WARN' : 'FAIL',
      (same ? 'same direction' : 'methods DISAGREE') + ' (' + pctTxt(Math.min.apply(null, ch)) + ' to ' +
      pctTxt(Math.max.apply(null, ch)) + ')');
    addDetail('C7 – three methods, ' + y0 + ' → ' + y1, ui.Label(M.map(function (x, i) {
      return (x[0] + '                    ').slice(0, 20) + fmt(x[1], 1) + ' → ' + fmt(x[2], 1) +
        ' km²  (' + pctTxt(ch[i]) + ')';
    }).join('\n') + '\nThe other two methods use hard classes, so their areas are not comparable to\n' +
      'tree fractions - only the direction and rough size of change are compared.', MONO));
    if (next) next();
  });
}

// C8 - grass / crop classifiers on held-out class samples
function runC8(next) {
  setRow('C8', 'RUN');
  if (!has(TRAIN_YEAR)) return fail('C8', 'asset for ' + TRAIN_YEAR + ' missing', next);
  var test = ee.FeatureCollection(ASSET_FOLDER + 'lahore_v7_class_samples').filter(ee.Filter.gte('split', 0.7))
    .select(['cls']);
  var withPred = img(TRAIN_YEAR).select(['grassp', 'cropp']).reduceRegions({collection: test,
    reducer: ee.Reducer.first(), scale: 10, tileScale: 4});
  withPred.filter(ee.Filter.notNull(['grassp'])).reduceColumns(ee.Reducer.toList(3), ['cls', 'grassp', 'cropp'])
  .get('list').evaluate(function (rows, err) {
    if (err) return fail('C8', err, next);
    var acc = function (truthFn, predFn) {
      var ok = 0; rows.forEach(function (x) { if (truthFn(x) === predFn(x)) ok++; }); return rows.length ? ok / rows.length : NaN;
    };
    var aG = acc(function (x) { return x[0] === 1; }, function (x) { return x[1] / 1000 >= GRASS_CUT && x[1] > x[2]; });
    var aC = acc(function (x) { return x[0] === 3; }, function (x) { return x[2] >= 500; });
    var mn = Math.min(aG, aC);
    setRow('C8', mn >= 0.9 ? 'PASS' : mn >= 0.8 ? 'WARN' : 'FAIL', 'grass vs not ' + fmt(100 * aG, 0) +
      '%, crops vs not ' + fmt(100 * aC, 0) + '% (' + rows.length + ' held-out points)');
    if (next) next();
  });
}

// C10 - independent tree change from NASA GEDI (space-borne laser canopy heights).
// Outside built-up land and water (where roofs would look like canopy), compare per year
// the share of GEDI shots with canopy >= 3 m with this model's tree share at the same spots.
function runC10(next) {
  setRow('C10', 'RUN');
  var place = worldCover.neq(50).and(worldCover.neq(80));
  var gedi = ee.ImageCollection(GEDI_ID).filterBounds(geom);
  var bands = [];
  YEARS.forEach(function (y) {
    var col = gedi.filterDate(ee.Date.fromYMD(y, 1, 1), ee.Date.fromYMD(y + 1, 1, 1)).map(function (im) {
      return im.select('rh98').updateMask(im.select('quality_flag').eq(1)
        .and(im.select('degrade_flag').eq(0)).and(im.select('sensitivity').gte(0.95)));
    });
    var rh = ee.Image(ee.Algorithms.If(col.size().gt(0), col.mean(),
      ee.Image.constant(0).rename('rh98').updateMask(0)));
    var m = rh.mask().and(place);
    bands.push(rh.gte(3).updateMask(m).rename('g' + y),
               treeFrac(y, {smooth: false}).updateMask(m).rename('t' + y));
  });
  ee.Image.cat(bands).clip(geom).reduceRegion({
    reducer: ee.Reducer.mean().combine(ee.Reducer.count(), null, true),
    geometry: geom, scale: 25, maxPixels: 1e10, tileScale: 4})
  .evaluate(function (r, err) {
    if (err) return fail('C10', String(err) + ' (edit GEDI_ID if the dataset name changed)', next);
    var ys = YEARS.filter(function (y) {
      return !isProvisional(y) && (r['g' + y + '_count'] || 0) >= 200 && r['g' + y + '_mean'] !== null;
    });
    var lines = ['Year   GEDI shots   GEDI share with canopy >= 3 m   model tree share (same spots)'];
    YEARS.forEach(function (y) {
      lines.push(y + '   ' + (String(r['g' + y + '_count'] || 0) + '          ').slice(0, 10) + '   ' +
        (fmt(100 * r['g' + y + '_mean'], 1) + '%                              ').slice(0, 30) + '   ' +
        fmt(100 * r['t' + y + '_mean'], 1) + '%' + (ys.indexOf(y) < 0 ? '   (not used)' : ''));
    });
    if (ys.length < 3) {
      setRow('C10', 'WARN', 'only ' + ys.length + ' year(s) with enough GEDI shots – cannot test change');
    } else {
      var G = ys.map(function (y) { return 100 * r['g' + y + '_mean']; });
      var T = ys.map(function (y) { return 100 * r['t' + y + '_mean']; });
      var sG = mannKendallSen(ys, G).sen, sT = mannKendallSen(ys, T).sen, rr = pearson(G, T);
      var sameDir = (sG >= 0) === (sT >= 0);
      var tiny = Math.abs(sG) < 0.2 && Math.abs(sT) < 0.2;      // both essentially flat (< 0.2 points/yr)
      var st = (sameDir || tiny) && rr >= 0.5 ? 'PASS' : (sameDir || tiny) ? 'WARN' : 'FAIL';
      setRow('C10', st, 'GEDI ' + (sG >= 0 ? '+' : '') + fmt(sG, 2) + ' vs model ' + (sT >= 0 ? '+' : '') + fmt(sT, 2) +
        ' points/yr (' + ys[0] + '–' + ys[ys.length - 1] + '), year-to-year r = ' + fmt(rr, 2));
      lines.push('', 'Trend: GEDI ' + fmt(sG, 2) + ' points/yr, model ' + fmt(sT, 2) + ' points/yr; correlation r = ' + fmt(rr, 2),
        'PASS: same direction (or both flat) and r ≥ 0.5. GEDI is a laser on the space station measuring',
        'actual height, so it shares no inputs with this model. Shots fall on different spots each year,',
        'so year-to-year values are noisy; the direction over several years is what matters.');
    }
    addDetail('C10 – tree change vs NASA GEDI (outside built-up land and water)', ui.Label(lines.join('\n'), MONO));
    if (next) next();
  });
}

// C11 - independent: where Google Open Buildings shows NEW buildings, green should have gone down.
function runC11(next) {
  setRow('C11', 'RUN');
  var y0 = Math.max(firstYear(), 2016), y1 = Math.min(lastComplete(), BUILDINGS_LAST);
  if (y1 <= y0) return fail('C11', 'no overlapping years with Open Buildings', next);
  var ob = ee.ImageCollection(BUILDINGS_ID).filterBounds(geom);
  var pres = function (y) {
    return ob.filterDate(ee.Date.fromYMD(y, 1, 1), ee.Date.fromYMD(y + 1, 1, 1)).select('building_presence').mosaic();
  };
  var newB = pres(y1).gte(0.5).and(pres(y0).lt(0.3));
  var g0 = greenAreaImg(y0), g1 = greenAreaImg(y1), dG = g1.subtract(g0);
  ee.Image.cat([AREA.updateMask(newB).rename('aNew'), dG.updateMask(newB).rename('dNew'),
                g0.updateMask(newB).rename('g0New'), AREA.updateMask(newB.and(dG.lt(0))).rename('aLoss')])
    .clip(geom).reduceRegion({reducer: ee.Reducer.sum(), geometry: geom, scale: 10, maxPixels: 1e11, tileScale: 8})
    .evaluate(function (r, err) {
      if (err) return fail('C11', String(err) + ' (edit BUILDINGS_ID if the dataset name changed)', next);
      var share = r.aNew ? r.aLoss / r.aNew : NaN;
      var st = r.dNew < 0 && share >= 0.6 ? 'PASS' : r.dNew < 0 ? 'WARN' : 'FAIL';
      setRow('C11', st, fmt(r.aNew, 1) + ' km² newly built ' + y0 + '→' + y1 + '; model shows green falling on ' +
        fmt(100 * share, 0) + '% of it (' + fmt(-r.dNew, 1) + ' km² of green lost)');
      addDetail('C11 – green lost to new buildings, ' + y0 + ' → ' + y1 + ' (Google Open Buildings 2.5D Temporal)',
        ui.Label(
          'Newly built land (building presence < 0.3 in ' + y0 + ', ≥ 0.5 in ' + y1 + '): ' + fmt(r.aNew, 2) + ' km²\n' +
          'Green there in ' + y0 + ': ' + fmt(r.g0New, 2) + ' km²; change by ' + y1 + ': ' + fmt(r.dNew, 2) + ' km²\n' +
          'Share of newly built land where the model shows green going down: ' + fmt(100 * share, 0) + '%\n' +
          'PASS: green falls on ≥ 60% of newly built land. This is a direct, independent test that the model\n' +
          'sees real green LOSS. Much new building happens on bare plots or crops, which were never counted\n' +
          'as green, so a small km² figure is expected.', MONO));
      if (next) next();
    });
}

// D2 - rainfall
function runD2(next) {
  setRow('D2', 'RUN');
  if (!RESULT.areas) { setRow('D2', 'ERROR', 'needs C9'); if (next) next(); return; }
  var bands = YEARS.map(function (y) {
    return ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY')
      .filterDate(ee.Date.fromYMD(y, 1, 1), ee.Date.fromYMD(y, 11, 1)).sum().rename('r' + y);
  });
  ee.Image.cat(bands).reduceRegion({reducer: ee.Reducer.mean(), geometry: geom, scale: 5000, maxPixels: 1e9})
  .evaluate(function (r, err) {
    if (err) { setRow('D2', 'ERROR', String(err)); if (next) next(); return; }
    var ys = trendYears().filter(function (y) { return r['r' + y] !== null && r['r' + y] !== undefined; });
    var rain = ys.map(function (y) { return r['r' + y]; });
    var green = ys.map(function (y) { return RESULT.areas.filter(function (x) { return x.year === y; })[0].green; });
    setRow('D2', 'INFO', 'r = ' + fmt(pearson(rain, green), 2) + ' between Jan–Oct rainfall and green area (' +
      ys.length + ' years; low power)');
    if (next) next();
  });
}

function showVerdict() {
  var scored = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C10', 'C11'];
  var fails = scored.filter(function (i) { return RESULT[i] && (RESULT[i].status === 'FAIL' || RESULT[i].status === 'ERROR'); });
  var warns = scored.filter(function (i) { return RESULT[i] && RESULT[i].status === 'WARN'; });
  var head = '';
  if (RESULT.areas) {
    var a0 = RESULT.areas.filter(function (x) { return x.year === firstYear(); })[0];
    var a1 = RESULT.areas.filter(function (x) { return x.year === lastComplete(); })[0];
    if (a0 && a1) {
      head = 'Model estimate: ' + fmt(a0.green, 1) + ' km² (' + a0.year + ') → ' + fmt(a1.green, 1) + ' km² (' +
        a1.year + ')';
      var tr = function (name, m, c) {
        return name + ' ' + fmt(m.sen, 2) + ' km²/yr (95% CI ' + fmt(c.lo, 2) + ' to ' + fmt(c.hi, 2) + ')' +
          (c.lo > 0 ? ' ✔' : c.hi < 0 ? ' ✔ (decrease)' : ' – not established');
      };
      if (RESULT.ci) head += '\nTrends: ' + tr('trees', RESULT.trendT, RESULT.ciT) + '; ' +
        tr('grass', RESULT.trendG, RESULT.ciG) + '; ' + tr('total', RESULT.trend, RESULT.ci);
      if (RESULT.c3) {
        var k = RESULT.c3.scale;
        head += '\nTree cover bias vs held-out canopy data: ' + pctTxt(100 * RESULT.c3.bias) + '. Bias-corrected ' +
          '(trees × ' + fmt(k, 2) + '): trees ' + fmt(a0.trees * k, 1) + ' → ' + fmt(a1.trees * k, 1) +
          ' km², total non-crop green ' + fmt(a0.trees * k + a0.grass, 1) + ' → ' + fmt(a1.trees * k + a1.grass, 1) +
          ' km².';
      }
      head += '\n';
    }
  }
  var v;
  if (fails.length) v = 'NOT SUPPORTED – failed: ' + fails.join(', ') + '. Do not report the change as real.';
  else if (warns.length) v = 'PARTLY SUPPORTED – warnings: ' + warns.join(', ') + '. Report as an estimate with caveats.';
  else v = 'WELL-SUPPORTED – all scored checks passed (no field validation; not "field-verified").';
  verdict.setValue(head + 'Verdict: ' + v);
}

function runAll() {
  if (DRIFT_CORRECT && !OFFSETS_READY) { verdict.setValue('Verdict: please wait until drift correction has loaded (see the status line).'); return; }
  detailHolder.clear();
  RESULT = {};
  CHECKS.forEach(function (c) { setRow(c[0], '• waiting'); });
  verdict.setValue('Verdict: running checks… (3–10 min)');
  var steps = [runC1, runC4, runC9, runC2, runC3, runC5, runC6, runC7, runC8, runC10, runC11, runD2];
  var i = 0;
  var go = function () { if (i < steps.length) steps[i++](go); else showVerdict(); };
  go();
}

// ---------------------------------------------------------------------
// 8. TIMELAPSE AND EXPORT
// ---------------------------------------------------------------------
var GIF_REGION = ee.Geometry.Rectangle([73.98, 31.06, 74.63, 31.70]);
var LEGEND_TOP = 31.215;
var GIF_SECONDS_PER_YEAR = 2;
function gifLegend(showContext) {
  var cell = 0.0034, rowH = 8 * cell;
  var items = [['00441b', 'Trees (dense)'], ['5bb36a', 'Trees (sparse)'], ['b5d950', 'Grass, lawns, parks']];
  if (showContext) items = items.concat([['efe6cf', 'Crops (not counted)'], ['bdbdbd', 'Built-up'], ['2b8cbe', 'Water']]);
  else items.push(['2b8cbe', 'Water']);
  var im = ee.Image(1).clip(ee.Geometry.Rectangle([73.98, 31.06, 74.63, LEGEND_TOP])).visualize({palette: ['ffffff']});
  items.forEach(function (it, i) {
    var x0 = 74.00 + Math.floor(i / 3) * 0.31, y0 = LEGEND_TOP - 0.012 - (i % 3) * rowH;
    var sw = ee.Geometry.Rectangle([x0, y0 - 5 * cell, x0 + 5 * cell, y0]);
    im = im.blend(ee.Image(1).clip(sw).visualize({palette: [it[0]]}))
      .blend(ee.Image().byte().paint(ee.FeatureCollection([ee.Feature(sw)]), 1, 1).visualize({palette: ['555555']}))
      .blend(textOnly(it[1], x0 + 7 * cell, y0, cell));
  });
  return im;
}
function makeTimelapse() {
  gifHolder.clear();
  gifHolder.add(ui.Label('Building animation… (1–3 min)', SMALL));
  var showContext = contextBox.getValue();
  var bgImg = ee.Image(1).visualize({palette: ['f4f4f4']});
  var legendImg = gifLegend(showContext);
  var frames = [];
  YEARS.forEach(function (y) {
    var L = layersFor(y);
    var frame = bgImg.blend(L.bg.visualize(BG_VIS))
      .blend(L.grass.visualize(grassMethod() === 'binary' ? {palette: [GRASS_COL.slice(1)]} : GRASS_VIS))
      .blend(L.trees.visualize(TREE_VIS)).blend(outline).blend(legendImg)
      .blend(textBox(String(y), 74.00, 31.69, 0.0055));
    for (var k = 0; k < GIF_SECONDS_PER_YEAR; k++) frames.push(frame);
  });
  gifHolder.clear();
  gifHolder.add(ui.Thumbnail({image: ee.ImageCollection(frames),
    params: {region: GIF_REGION, dimensions: 640, framesPerSecond: 1, crs: 'EPSG:3857'}, style: {width: '640px'}}));
  gifHolder.add(ui.Label('Right-click the animation to save it as a GIF.', SMALL));
}
function exportYear() {
  if (!selectedYear) return;
  var y = selectedYear;
  Export.image.toDrive({image: treeFrac(y).multiply(100).rename('tree_pct')
      .addBands(grassFrac(y).multiply(100).rename('grass_pct')).toByte(),
    description: 'lahore_green_v7_' + y, folder: FOLDER, region: geom, scale: 10, maxPixels: 1e11,
    formatOptions: {cloudOptimized: true}});
  exportMsg.setValue('Task created for ' + y + '. Bands: tree_pct (0–100 % tree cover per 10 m pixel), ' +
    'grass_pct (0–100 % grass/lawn/park per pixel). Open Tasks and click RUN.');
}

// ---------------------------------------------------------------------
// 8b. GRAPHICS DATA (only when EXPORT_GRAPHICS = true): prints GRAPHICS_DATA to the Console
//     for tools/build_visuals.py (hotspot map and Lahore vs benchmarks graphic)
// ---------------------------------------------------------------------
var HOT_VIS = {min: -0.15, max: 0.15,
  palette: ['#b2182b', '#ef8a62', '#fddbc7', '#f7f7f7', '#d9f0d3', '#7fbf7b', '#1b7837']};

function exportGraphicsData() {
  var y0 = firstYear(), y1 = lastComplete();
  print('Preparing graphics data for ' + y0 + ' → ' + y1 + ' (1–3 min)…');
  // green gained or lost per 1 km square, named after the nearest place
  var dG = greenAreaImg(y1).subtract(greenAreaImg(y0)).rename('d');
  var cells = dG.reduceRegions({collection: geom.coveringGrid(ee.Projection('EPSG:32643').atScale(1000)),
      reducer: ee.Reducer.sum(), scale: STAT_SCALE, tileScale: 4})
    .filter(ee.Filter.notNull(['sum']))
    .map(function (f) {
      var c = f.geometry().centroid(1).coordinates();
      return f.set({lon: c.get(0), lat: c.get(1)});
    });
  var cellImg = cells.reduceToImage(['sum'], ee.Reducer.first()).rename('d').clip(geom);
  var bg = ee.Image(1).visualize({palette: ['f4f4f4']});
  var hotPng = bg.blend(cellImg.visualize(HOT_VIS)).blend(outline);
  // Lahore vs benchmarks for the last complete year
  var stack = ee.Image.cat([treeAreaImg(y1), greenAreaImg(y1), AREA.rename('all'), peopleImg(),
                            peopleImg().multiply(nearParkImg()).rename('popNear')]).clip(geom);
  var tot = stack.reduceRegion({reducer: ee.Reducer.sum(), geometry: geom, scale: STAT_SCALE,
    maxPixels: 1e11, tileScale: 4});
  var zones = stack.select(['trees', 'green', 'all', 'pop']).addBands(zoneImage())
    .reduceRegion({reducer: ee.Reducer.sum().repeat(4).group({groupField: 4, groupName: 'zone'}),
      geometry: geom, scale: STAT_SCALE, maxPixels: 1e11, tileScale: 8});
  var cols = ['sum', 'lon', 'lat'];
  ee.Dictionary({
    tot: tot, zones: zones.get('groups'),
    gain: cells.sort('sum', false).limit(12).reduceColumns(ee.Reducer.toList(3), cols).get('list'),
    loss: cells.sort('sum', true).limit(12).reduceColumns(ee.Reducer.toList(3), cols).get('list')
  }).evaluate(function (r, err) {
    if (err) { print('Graphics data error: ' + err); return; }
    // label hotspots with the nearest recognisable neighbourhood or town (dropdown list), not villages
    var nearestHood = function (lon, lat) {
      var best = null, bestKm = 1e9;
      PLACES.forEach(function (p) {
        var dx = (p[1] - lon) * 111.32 * Math.cos(lat * Math.PI / 180), dy = (p[2] - lat) * 110.57;
        var km = Math.sqrt(dx * dx + dy * dy);
        if (km < bestKm) { bestKm = km; best = p[0]; }
      });
      return best;
    };
    var named = function (list) {           // one entry per place name, at most 4
      var seen = {}, out = [];
      list.forEach(function (x) {
        var nm = nearestHood(x[1], x[2]);
        if (!seen[nm] && out.length < 4) { seen[nm] = true; out.push({name: nm, km2: Math.round(x[0] * 100) / 100}); }
      });
      return out;
    };
    var rows = (r.zones || []).map(function (g) {
      var s = g.sum;
      return {zone: g.zone, name: ZONE_PLACES[g.zone][0], village: g.zone >= PLACES.length,
        canopy: 100 * s[0] / s[2], perRes: s[3] > 0 ? 1e6 * s[1] / s[3] : null, pop: s[3]};
    });
    var hoods = rows.filter(function (z) { return !z.village; });
    var byCanopy = hoods.slice().sort(function (a, b) { return b.canopy - a.canopy; });
    var brief = function (z) { return {name: z.name, canopy: Math.round(z.canopy * 10) / 10}; };
    var classes = [0, 0, 0, 0, 0];
    hoods.forEach(function (z) { classes[bmClass(z.canopy)]++; });
    var zoneLayer = zoneImage().remap(rows.map(function (z) { return z.zone; }),
                                      rows.map(function (z) { return bmClass(z.canopy); }))
      .visualize({min: 0, max: 4, palette: BM_PAL});
    var benchPng = bg.blend(zoneLayer).blend(outline);
    var t = r.tot;
    var params = {region: GIF_REGION, dimensions: 1080, crs: 'EPSG:3857', format: 'png'};
    hotPng.getThumbURL(params, function (hotUrl) {
      benchPng.getThumbURL(params, function (benchUrl) {
        print('GRAPHICS_DATA ' + JSON.stringify({
          region: [73.98, 31.06, 74.63, 31.70], hotspotYears: [y0, y1], hotspotScale: 0.15,
          hotColours: HOT_VIS.palette,
          frames: {hotspot: hotUrl, bench: benchUrl},
          gains: named(r.gain), losses: named(r.loss),
          bench: {year: y1, canopy: 100 * t.trees / t.all, perRes: 1e6 * t.green / t.pop,
            parkAccess: 100 * t.popNear / t.pop, population: t.pop,
            meet: hoods.filter(function (z) { return z.canopy >= 30; }).length, hoods: hoods.length,
            classes: classes, palette: BM_PAL,
            top: byCanopy.slice(0, 5).map(brief), bottom: byCanopy.slice(-5).reverse().map(brief)}
        }));
        print('Copy the whole GRAPHICS_DATA line above and send it to Claude.');
      });
    });
  });
}

// ---------------------------------------------------------------------
// 9. START
// ---------------------------------------------------------------------
map.setCenter(74.30, 31.46, 10);
ui.util.setTimeout(function () { map.centerObject(lahore); }, 2000);
function start(found) {
  YEARS = ALL_YEARS.filter(function (y) { return found.indexOf(y) >= 0; });
  buildTabs();
  if (!YEARS.length) {
    setStatus('No yearly map data found in ' + ASSET_FOLDER + '. Run Script A v7 (STEP 1, then STEP 2) first.');
    return;
  }
  var missing = ALL_YEARS.filter(function (y) { return YEARS.indexOf(y) < 0; });
  setStatus('Preparing the maps\u2026 (about 30 s)');
  loadOffsets(function (note) {
    setStatus((missing.length ? 'Years not available yet: ' + missing.join(', ') + '. ' : '') + (note || ''));
    selectedYear = lastComplete() || YEARS[YEARS.length - 1];
    chFrom.setValue(String(firstYear()), false);
    chTo.setValue(String(lastComplete() || YEARS[YEARS.length - 1]), false);
    setMode('year');
    if (EXPORT_GRAPHICS) exportGraphicsData();
    if (EXPORT_BENCH) exportBenchAssets();
  });
}
checkBenchAssets();
ee.data.listAssets(ASSET_FOLDER.replace(/\/$/, ''), {}, function (res, err) {
  if (err || !res) { start(ALL_YEARS); return; }
  var names = (res.assets || []).map(function (a) { return a.name || a.id || ''; });
  start(ALL_YEARS.filter(function (y) {
    return names.some(function (n) { return n.slice(-('lahore_v7_' + y).length) === 'lahore_v7_' + y; });
  }));
});

})();
