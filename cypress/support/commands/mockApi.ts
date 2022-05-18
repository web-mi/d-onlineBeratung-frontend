import {
	generateAskerSession,
	generateConsultantSession,
	generateMessagesReply,
	sessionsReply
} from '../sessions';
import { config } from '../../../src/resources/scripts/config';
import {
	getAskerSessions,
	setAskerSessions,
	updateAskerSession
} from './askerSessions';
import {
	getConsultantSessions,
	setConsultantSessions,
	updateConsultantSession
} from './consultantSessions';
import { LoginArgs, USER_ASKER } from './login';
import { deepMerge } from '../helpers';
import { decodeUsername } from '../../../src/utils/encryptionHelpers';
import { getMessages, setMessages } from './messages';
import apiAppointments from './api/appointments';
import apiVideocalls from './api/videocalls';

let overrides = {};

const defaultReturns = {
	attachmentUpload: {
		statusCode: 201
	},
	userData: {},
	consultingTypes: [],
	releases: {
		statusCode: 404
	}
};

Cypress.Commands.add('willReturn', (name: string, data: any) => {
	overrides[name] = data;
});

let username = null;

Cypress.Commands.add('mockApi', () => {
	// Empty overrides
	overrides = {};

	setAskerSessions([]);
	cy.askerSession(generateAskerSession());

	setConsultantSessions([]);
	cy.consultantSession(generateConsultantSession());
	cy.consultantSession(generateConsultantSession());
	cy.consultantSession(generateConsultantSession());

	setMessages([]);
	cy.addMessage({}, 0);
	cy.addMessage({}, 1);
	cy.addMessage({}, 2);

	// ConsultingTypes
	cy.fixture('service.consultingtypes.emigration.json').then(
		(consultingType) => {
			defaultReturns['consultingTypes'].push(consultingType);
		}
	);
	cy.fixture('service.consultingtypes.addiction.json').then(
		(consultingType) => {
			defaultReturns['consultingTypes'].push(consultingType);
		}
	);
	cy.fixture('service.consultingtypes.pregnancy.json').then(
		(consultingType) => {
			defaultReturns['consultingTypes'].push(consultingType);
		}
	);
	cy.fixture('service.consultingtypes.u25.json').then((consultingType) => {
		defaultReturns['consultingTypes'].push(consultingType);
	});

	cy.fixture('api.v1.login').then((data) => {
		cy.intercept('POST', config.endpoints.rc.accessToken, (req) => {
			username = decodeUsername(req.body.username);
			req.reply(
				deepMerge(data, {
					data: { userId: decodeUsername(req.body.username) }
				})
			);
		});
	});

	cy.fixture('auth.token').then((auth) => {
		defaultReturns['auth'] = auth;
	});

	cy.fixture('service.users.data.consultants').then((usersData) => {
		usersData.forEach((userData) => {
			defaultReturns['userData'][userData.userId] = userData;
		});
	});
	cy.fixture('service.users.data.askers').then((userData) => {
		defaultReturns['userData'][USER_ASKER] = userData;
	});

	cy.intercept('GET', `${config.endpoints.consultantSessions}*`, (req) => {
		if (overrides['consultantSessions']) {
			return req.reply(overrides['consultantSessions']);
		}

		const url = new URL(req.url);

		const offset = parseInt(url.searchParams.get('offset')) || 0;
		const count = parseInt(url.searchParams.get('count')) || 15;

		req.reply(
			sessionsReply({
				sessions: getConsultantSessions(),
				offset,
				count
			})
		);
	}).as('consultantSessions');

	cy.intercept('GET', config.endpoints.askerSessions, (req) => {
		if (overrides['askerSessions']) {
			return req.reply(overrides['askerSessions']);
		}

		req.reply({
			sessions: getAskerSessions()
		});
	}).as('askerSessions');

	cy.intercept('GET', config.endpoints.messages, (req) => {
		if (overrides['messages']) {
			return req.reply(overrides['messages']);
		}

		const url = new URL(req.url);

		req.reply(
			generateMessagesReply(
				getMessages().filter(
					(message) =>
						message.rid === url.searchParams.get('rcGroupId')
				)
			)
		);
	}).as('messages');

	cy.intercept('POST', config.endpoints.rc.subscriptions.read, (req) => {
		getAskerSessions().forEach((session, index) => {
			if (session.session.groupId === req.body.rid) {
				updateAskerSession({ session: { messagesRead: true } }, index);
			}
		});

		getConsultantSessions().forEach((session, index) => {
			if (session.session.groupId === req.body.rid) {
				updateConsultantSession(
					{ session: { messagesRead: true } },
					index
				);
			}
		});

		req.reply('{}');
	}).as('sessionRead');

	cy.intercept('GET', `${config.endpoints.consultantEnquiriesBase}*`, {}).as(
		'consultantEnquiriesBase'
	);

	cy.intercept('POST', config.endpoints.keycloakLogout, {}).as('authLogout');

	cy.intercept('POST', config.endpoints.rc.logout, {}).as('apiLogout');

	cy.intercept(`${config.endpoints.liveservice}/**/*`, {
		entropy: -1197552011,
		origins: ['*:*'],
		cookie_needed: false,
		websocket: true
	});

	cy.intercept('GET', config.endpoints.draftMessages, {}).as('draftMessages');

	cy.intercept('POST', config.endpoints.startVideoCall, {
		fixture: 'service.videocalls.new'
	}).as('startVideoCall');

	cy.intercept('POST', config.endpoints.rejectVideoCall, {}).as(
		'rejectVideoCall'
	);

	cy.intercept('POST', config.endpoints.attachmentUpload, (req) =>
		req.reply({
			...defaultReturns['attachmentUpload'],
			...(overrides['attachmentUpload'] || {})
		})
	).as('attachmentUpload');

	cy.intercept('POST', config.endpoints.keycloakAccessToken, (req) => {
		req.reply({
			...defaultReturns['auth'],
			...(overrides['auth'] || {})
		});
	}).as('authToken');

	cy.intercept('GET', config.endpoints.userData, (req) => {
		req.reply({
			...defaultReturns['userData'][username],
			...(overrides['userData'] || {})
		});
	}).as('usersData');

	cy.intercept(
		`${config.endpoints.consultingTypeServiceBase}/byslug/*/full`,
		(req) => {
			const slug = new URL(req.url).pathname.split('/')[4];

			req.reply({
				...(defaultReturns['consultingTypes'].find(
					(consultingType) => consultingType.slug === slug
				) || {}),
				...(overrides['consultingType'] || {})
			});
		}
	).as('consultingTypeServiceBySlugFull');

	cy.intercept(
		`${config.endpoints.consultingTypeServiceBase}/*/full`,
		(req) => {
			const id = parseInt(new URL(req.url).pathname.split('/')[3]);

			req.reply({
				...(defaultReturns['consultingTypes'].find(
					(consultingType) => consultingType.id === id
				) || {}),
				...(overrides['consultingType'] || {})
			});
		}
	).as('consultingTypeServiceBaseFull');

	cy.intercept(
		`${config.endpoints.consultingTypeServiceBase}/basic`,
		(req) => {
			req.reply([
				...defaultReturns['consultingTypes'],
				...(overrides['consultingTypes'] || [])
			]);
		}
	).as('consultingTypeServiceBaseBasic');

	cy.intercept('GET', '/releases/*', (req) => {
		req.reply({
			...defaultReturns['releases'],
			...(overrides['releases'] || {})
		});
	}).as('releases');

	apiAppointments(cy);
	apiVideocalls(cy);

	cy.intercept('GET', '/api/v1/e2e.fetchMyKeys', (req) => {
		req.reply({
			success: true,
			public_key:
				'{"alg":"RSA-OAEP-256","e":"AQAB","ext":true,"key_ops":["encrypt"],"kty":"RSA","n":"im5YigSA0j-VpZV2hpA0heh4R02sjvyOwtgY50IwqmwDqovQZjFhGaGkCgfwCDO-NA1FFPLIPeZIn4uyilndQFY_GWQf6cd6mC0SQKmTbzHIW9TpKqJ7RlnKmR8DCtG7jOj2GRimKenA-mGrdKwV6TLu5Yw1WN1r36Pirn2U9H-AOb_7BIJXG7KX_EajWBJ1myan2B7nw17b_GATxbbK4XCnzjXSNsudm9qGD_RAB6BaGDV5rCL3-EHsMvx8wtdFuGQKKALHi1X-NuL7PDAPlYu6uqOaLT9Cnfy0mQYYzjMD2gsLdhr2MCLYbPUnQ5_lXK7iFEQ6hjdcV82-GYOEyQ"}',
			private_key:
				'{"0":235,"1":178,"2":15,"3":144,"4":52,"5":25,"6":179,"7":155,"8":115,"9":236,"10":229,"11":251,"12":203,"13":49,"14":64,"15":253,"16":148,"17":103,"18":166,"19":86,"20":233,"21":49,"22":157,"23":164,"24":77,"25":238,"26":142,"27":222,"28":140,"29":224,"30":205,"31":222,"32":145,"33":85,"34":255,"35":27,"36":106,"37":176,"38":200,"39":135,"40":122,"41":4,"42":117,"43":98,"44":172,"45":20,"46":63,"47":229,"48":133,"49":248,"50":127,"51":43,"52":2,"53":196,"54":205,"55":103,"56":167,"57":62,"58":163,"59":242,"60":199,"61":140,"62":114,"63":39,"64":55,"65":114,"66":75,"67":26,"68":241,"69":112,"70":243,"71":170,"72":126,"73":235,"74":132,"75":19,"76":240,"77":98,"78":59,"79":89,"80":3,"81":158,"82":41,"83":40,"84":198,"85":50,"86":167,"87":21,"88":206,"89":196,"90":84,"91":60,"92":156,"93":129,"94":141,"95":171,"96":204,"97":15,"98":76,"99":206,"100":149,"101":150,"102":67,"103":99,"104":92,"105":191,"106":227,"107":238,"108":188,"109":14,"110":8,"111":109,"112":90,"113":13,"114":154,"115":122,"116":160,"117":30,"118":170,"119":25,"120":160,"121":31,"122":231,"123":142,"124":89,"125":34,"126":131,"127":122,"128":254,"129":175,"130":192,"131":122,"132":55,"133":172,"134":29,"135":168,"136":174,"137":181,"138":124,"139":175,"140":66,"141":184,"142":149,"143":129,"144":205,"145":149,"146":90,"147":17,"148":96,"149":181,"150":57,"151":86,"152":121,"153":62,"154":105,"155":237,"156":171,"157":68,"158":94,"159":77,"160":134,"161":85,"162":117,"163":127,"164":173,"165":149,"166":52,"167":189,"168":124,"169":75,"170":171,"171":162,"172":169,"173":6,"174":91,"175":179,"176":254,"177":14,"178":204,"179":78,"180":161,"181":162,"182":193,"183":62,"184":154,"185":98,"186":112,"187":30,"188":93,"189":166,"190":161,"191":94,"192":222,"193":194,"194":254,"195":33,"196":182,"197":246,"198":160,"199":45,"200":47,"201":109,"202":198,"203":76,"204":206,"205":234,"206":49,"207":132,"208":208,"209":212,"210":73,"211":197,"212":108,"213":240,"214":152,"215":184,"216":209,"217":85,"218":105,"219":88,"220":126,"221":40,"222":218,"223":246,"224":107,"225":179,"226":176,"227":50,"228":180,"229":162,"230":236,"231":151,"232":202,"233":250,"234":109,"235":245,"236":131,"237":227,"238":98,"239":96,"240":171,"241":135,"242":85,"243":155,"244":254,"245":129,"246":143,"247":227,"248":67,"249":177,"250":142,"251":155,"252":100,"253":209,"254":135,"255":244,"256":212,"257":48,"258":18,"259":120,"260":113,"261":145,"262":109,"263":166,"264":79,"265":69,"266":162,"267":21,"268":234,"269":146,"270":149,"271":0,"272":159,"273":127,"274":79,"275":129,"276":255,"277":9,"278":32,"279":65,"280":131,"281":48,"282":11,"283":158,"284":191,"285":20,"286":235,"287":109,"288":193,"289":249,"290":210,"291":245,"292":192,"293":126,"294":185,"295":110,"296":97,"297":185,"298":226,"299":244,"300":83,"301":196,"302":65,"303":88,"304":92,"305":233,"306":58,"307":101,"308":216,"309":8,"310":227,"311":101,"312":115,"313":10,"314":1,"315":79,"316":54,"317":223,"318":178,"319":231,"320":4,"321":110,"322":223,"323":136,"324":105,"325":47,"326":120,"327":129,"328":253,"329":91,"330":94,"331":115,"332":185,"333":206,"334":1,"335":98,"336":204,"337":39,"338":120,"339":116,"340":153,"341":115,"342":0,"343":51,"344":255,"345":167,"346":216,"347":45,"348":125,"349":1,"350":207,"351":53,"352":236,"353":85,"354":180,"355":0,"356":70,"357":180,"358":142,"359":14,"360":64,"361":241,"362":107,"363":1,"364":180,"365":211,"366":111,"367":39,"368":50,"369":62,"370":157,"371":41,"372":19,"373":101,"374":145,"375":185,"376":252,"377":221,"378":37,"379":1,"380":136,"381":169,"382":105,"383":240,"384":185,"385":165,"386":108,"387":67,"388":119,"389":221,"390":79,"391":103,"392":219,"393":200,"394":202,"395":213,"396":203,"397":243,"398":66,"399":135,"400":26,"401":128,"402":127,"403":28,"404":69,"405":54,"406":159,"407":66,"408":213,"409":144,"410":155,"411":236,"412":99,"413":69,"414":160,"415":17,"416":56,"417":89,"418":122,"419":85,"420":13,"421":41,"422":166,"423":55,"424":103,"425":5,"426":36,"427":70,"428":21,"429":85,"430":185,"431":76,"432":244,"433":91,"434":86,"435":99,"436":7,"437":182,"438":227,"439":6,"440":219,"441":210,"442":211,"443":137,"444":15,"445":254,"446":75,"447":127,"448":180,"449":214,"450":150,"451":228,"452":38,"453":88,"454":37,"455":81,"456":84,"457":147,"458":5,"459":161,"460":132,"461":162,"462":245,"463":205,"464":155,"465":235,"466":23,"467":190,"468":223,"469":212,"470":164,"471":187,"472":96,"473":134,"474":116,"475":89,"476":156,"477":189,"478":192,"479":169,"480":225,"481":212,"482":224,"483":132,"484":112,"485":38,"486":44,"487":153,"488":175,"489":224,"490":151,"491":224,"492":16,"493":153,"494":45,"495":209,"496":85,"497":84,"498":55,"499":111,"500":134,"501":45,"502":5,"503":206,"504":169,"505":124,"506":189,"507":159,"508":24,"509":75,"510":49,"511":67,"512":206,"513":81,"514":168,"515":167,"516":28,"517":52,"518":165,"519":127,"520":149,"521":31,"522":135,"523":241,"524":172,"525":147,"526":246,"527":80,"528":215,"529":189,"530":248,"531":162,"532":19,"533":183,"534":58,"535":122,"536":38,"537":212,"538":133,"539":123,"540":198,"541":118,"542":251,"543":107,"544":85,"545":123,"546":182,"547":142,"548":96,"549":136,"550":219,"551":136,"552":253,"553":44,"554":211,"555":84,"556":79,"557":94,"558":149,"559":229,"560":115,"561":231,"562":46,"563":50,"564":95,"565":156,"566":37,"567":48,"568":230,"569":38,"570":248,"571":176,"572":56,"573":56,"574":120,"575":199,"576":7,"577":29,"578":118,"579":248,"580":93,"581":220,"582":44,"583":10,"584":245,"585":249,"586":165,"587":232,"588":45,"589":155,"590":46,"591":143,"592":63,"593":230,"594":85,"595":242,"596":25,"597":55,"598":73,"599":19,"600":123,"601":144,"602":138,"603":233,"604":148,"605":35,"606":196,"607":113,"608":77,"609":214,"610":119,"611":56,"612":228,"613":69,"614":62,"615":227,"616":7,"617":112,"618":45,"619":27,"620":158,"621":128,"622":27,"623":50,"624":133,"625":100,"626":43,"627":152,"628":74,"629":239,"630":152,"631":96,"632":222,"633":217,"634":211,"635":13,"636":1,"637":169,"638":161,"639":114,"640":61,"641":100,"642":246,"643":211,"644":156,"645":173,"646":113,"647":138,"648":118,"649":92,"650":34,"651":64,"652":225,"653":185,"654":162,"655":254,"656":38,"657":192,"658":130,"659":198,"660":254,"661":85,"662":23,"663":47,"664":27,"665":228,"666":31,"667":96,"668":234,"669":132,"670":49,"671":131,"672":204,"673":80,"674":211,"675":211,"676":32,"677":190,"678":223,"679":103,"680":70,"681":92,"682":9,"683":10,"684":33,"685":31,"686":63,"687":65,"688":183,"689":136,"690":185,"691":46,"692":1,"693":178,"694":248,"695":175,"696":112,"697":111,"698":20,"699":95,"700":64,"701":184,"702":247,"703":183,"704":133,"705":190,"706":16,"707":102,"708":131,"709":31,"710":34,"711":28,"712":72,"713":217,"714":115,"715":137,"716":10,"717":66,"718":251,"719":98,"720":37,"721":125,"722":212,"723":215,"724":151,"725":113,"726":125,"727":64,"728":230,"729":115,"730":142,"731":234,"732":231,"733":234,"734":31,"735":197,"736":116,"737":165,"738":72,"739":253,"740":199,"741":178,"742":198,"743":34,"744":66,"745":74,"746":198,"747":1,"748":135,"749":103,"750":210,"751":45,"752":169,"753":28,"754":29,"755":138,"756":88,"757":101,"758":254,"759":149,"760":61,"761":158,"762":16,"763":138,"764":203,"765":131,"766":6,"767":230,"768":194,"769":30,"770":3,"771":103,"772":16,"773":98,"774":253,"775":58,"776":66,"777":163,"778":31,"779":194,"780":157,"781":242,"782":100,"783":73,"784":122,"785":239,"786":2,"787":157,"788":122,"789":61,"790":99,"791":175,"792":193,"793":201,"794":87,"795":2,"796":194,"797":31,"798":236,"799":221,"800":91,"801":77,"802":129,"803":93,"804":48,"805":35,"806":165,"807":18,"808":59,"809":56,"810":101,"811":148,"812":230,"813":222,"814":141,"815":196,"816":92,"817":63,"818":92,"819":83,"820":16,"821":8,"822":124,"823":90,"824":201,"825":251,"826":13,"827":186,"828":219,"829":226,"830":121,"831":238,"832":178,"833":12,"834":60,"835":178,"836":77,"837":112,"838":234,"839":240,"840":49,"841":175,"842":58,"843":138,"844":208,"845":5,"846":37,"847":23,"848":64,"849":146,"850":138,"851":237,"852":16,"853":28,"854":248,"855":20,"856":163,"857":52,"858":72,"859":26,"860":207,"861":143,"862":31,"863":185,"864":97,"865":101,"866":162,"867":241,"868":97,"869":137,"870":94,"871":60,"872":117,"873":215,"874":22,"875":198,"876":223,"877":226,"878":160,"879":209,"880":128,"881":1,"882":54,"883":188,"884":13,"885":39,"886":215,"887":92,"888":62,"889":108,"890":85,"891":219,"892":108,"893":199,"894":126,"895":8,"896":28,"897":30,"898":151,"899":197,"900":26,"901":128,"902":86,"903":81,"904":165,"905":195,"906":87,"907":201,"908":201,"909":106,"910":148,"911":2,"912":200,"913":74,"914":16,"915":28,"916":195,"917":234,"918":154,"919":137,"920":136,"921":91,"922":106,"923":164,"924":61,"925":90,"926":194,"927":126,"928":25,"929":144,"930":4,"931":209,"932":130,"933":46,"934":87,"935":185,"936":230,"937":51,"938":37,"939":184,"940":237,"941":102,"942":153,"943":111,"944":191,"945":67,"946":60,"947":153,"948":62,"949":196,"950":132,"951":206,"952":79,"953":183,"954":64,"955":14,"956":127,"957":21,"958":40,"959":26,"960":10,"961":31,"962":159,"963":183,"964":101,"965":128,"966":173,"967":189,"968":242,"969":61,"970":232,"971":111,"972":206,"973":72,"974":53,"975":45,"976":253,"977":30,"978":24,"979":246,"980":79,"981":102,"982":137,"983":52,"984":39,"985":132,"986":64,"987":120,"988":6,"989":86,"990":5,"991":219,"992":129,"993":99,"994":156,"995":232,"996":23,"997":159,"998":196,"999":133,"1000":68,"1001":113,"1002":2,"1003":204,"1004":152,"1005":70,"1006":9,"1007":99,"1008":85,"1009":104,"1010":7,"1011":154,"1012":12,"1013":2,"1014":164,"1015":19,"1016":11,"1017":115,"1018":215,"1019":98,"1020":67,"1021":197,"1022":19,"1023":224,"1024":199,"1025":8,"1026":6,"1027":83,"1028":136,"1029":147,"1030":162,"1031":250,"1032":189,"1033":123,"1034":97,"1035":209,"1036":221,"1037":122,"1038":191,"1039":65,"1040":13,"1041":122,"1042":94,"1043":60,"1044":229,"1045":203,"1046":24,"1047":57,"1048":104,"1049":30,"1050":220,"1051":239,"1052":90,"1053":38,"1054":233,"1055":159,"1056":176,"1057":248,"1058":147,"1059":209,"1060":9,"1061":156,"1062":30,"1063":116,"1064":240,"1065":46,"1066":10,"1067":54,"1068":99,"1069":86,"1070":79,"1071":2,"1072":110,"1073":235,"1074":185,"1075":38,"1076":69,"1077":118,"1078":0,"1079":0,"1080":57,"1081":149,"1082":38,"1083":240,"1084":60,"1085":101,"1086":75,"1087":40,"1088":27,"1089":125,"1090":255,"1091":206,"1092":81,"1093":252,"1094":243,"1095":228,"1096":229,"1097":204,"1098":153,"1099":215,"1100":37,"1101":244,"1102":183,"1103":47,"1104":198,"1105":40,"1106":230,"1107":97,"1108":153,"1109":244,"1110":182,"1111":66,"1112":4,"1113":1,"1114":121,"1115":113,"1116":205,"1117":242,"1118":192,"1119":128,"1120":93,"1121":53,"1122":67,"1123":209,"1124":85,"1125":5,"1126":38,"1127":22,"1128":222,"1129":126,"1130":220,"1131":248,"1132":251,"1133":52,"1134":102,"1135":59,"1136":161,"1137":80,"1138":73,"1139":135,"1140":233,"1141":110,"1142":93,"1143":48,"1144":117,"1145":71,"1146":126,"1147":53,"1148":253,"1149":77,"1150":107,"1151":168,"1152":160,"1153":113,"1154":212,"1155":24,"1156":254,"1157":136,"1158":231,"1159":61,"1160":147,"1161":70,"1162":227,"1163":207,"1164":99,"1165":99,"1166":71,"1167":166,"1168":83,"1169":66,"1170":209,"1171":85,"1172":24,"1173":1,"1174":82,"1175":33,"1176":40,"1177":175,"1178":206,"1179":93,"1180":166,"1181":9,"1182":138,"1183":239,"1184":34,"1185":131,"1186":113,"1187":103,"1188":187,"1189":13,"1190":88,"1191":68,"1192":120,"1193":64,"1194":100,"1195":77,"1196":189,"1197":75,"1198":174,"1199":68,"1200":37,"1201":31,"1202":161,"1203":93,"1204":216,"1205":12,"1206":145,"1207":105,"1208":105,"1209":129,"1210":134,"1211":232,"1212":171,"1213":209,"1214":190,"1215":39,"1216":71,"1217":141,"1218":28,"1219":162,"1220":79,"1221":3,"1222":225,"1223":113,"1224":85,"1225":155,"1226":222,"1227":144,"1228":182,"1229":125,"1230":145,"1231":210,"1232":133,"1233":253,"1234":217,"1235":91,"1236":166,"1237":255,"1238":139,"1239":111,"1240":24,"1241":194,"1242":211,"1243":241,"1244":191,"1245":34,"1246":222,"1247":216,"1248":212,"1249":240,"1250":121,"1251":155,"1252":56,"1253":47,"1254":188,"1255":20,"1256":73,"1257":139,"1258":121,"1259":35,"1260":9,"1261":244,"1262":191,"1263":30,"1264":234,"1265":51,"1266":230,"1267":98,"1268":254,"1269":51,"1270":220,"1271":239,"1272":43,"1273":219,"1274":255,"1275":89,"1276":77,"1277":184,"1278":244,"1279":112,"1280":13,"1281":19,"1282":197,"1283":62,"1284":145,"1285":26,"1286":91,"1287":109,"1288":44,"1289":101,"1290":9,"1291":138,"1292":78,"1293":214,"1294":247,"1295":202,"1296":28,"1297":209,"1298":179,"1299":88,"1300":182,"1301":149,"1302":186,"1303":35,"1304":178,"1305":196,"1306":210,"1307":26,"1308":40,"1309":243,"1310":135,"1311":177,"1312":186,"1313":220,"1314":36,"1315":179,"1316":142,"1317":129,"1318":232,"1319":103,"1320":154,"1321":81,"1322":147,"1323":177,"1324":168,"1325":182,"1326":10,"1327":79,"1328":113,"1329":228,"1330":206,"1331":71,"1332":20,"1333":227,"1334":149,"1335":130,"1336":13,"1337":135,"1338":7,"1339":37,"1340":72,"1341":156,"1342":255,"1343":83,"1344":36,"1345":69,"1346":39,"1347":46,"1348":212,"1349":122,"1350":75,"1351":23,"1352":41,"1353":222,"1354":70,"1355":45,"1356":50,"1357":97,"1358":248,"1359":135,"1360":187,"1361":172,"1362":197,"1363":171,"1364":203,"1365":201,"1366":252,"1367":211,"1368":108,"1369":70,"1370":200,"1371":224,"1372":80,"1373":17,"1374":168,"1375":185,"1376":6,"1377":199,"1378":242,"1379":31,"1380":99,"1381":0,"1382":63,"1383":83,"1384":0,"1385":135,"1386":128,"1387":82,"1388":51,"1389":3,"1390":230,"1391":188,"1392":5,"1393":198,"1394":251,"1395":234,"1396":37,"1397":88,"1398":94,"1399":249,"1400":162,"1401":181,"1402":225,"1403":72,"1404":221,"1405":139,"1406":220,"1407":222,"1408":94,"1409":184,"1410":159,"1411":251,"1412":25,"1413":217,"1414":216,"1415":237,"1416":9,"1417":0,"1418":242,"1419":81,"1420":147,"1421":207,"1422":222,"1423":186,"1424":159,"1425":226,"1426":177,"1427":17,"1428":239,"1429":66,"1430":175,"1431":198,"1432":159,"1433":165,"1434":56,"1435":45,"1436":208,"1437":220,"1438":116,"1439":115,"1440":18,"1441":66,"1442":177,"1443":91,"1444":5,"1445":239,"1446":73,"1447":153,"1448":246,"1449":9,"1450":158,"1451":56,"1452":81,"1453":134,"1454":242,"1455":153,"1456":222,"1457":5,"1458":66,"1459":194,"1460":86,"1461":239,"1462":117,"1463":158,"1464":118,"1465":247,"1466":59,"1467":202,"1468":109,"1469":114,"1470":156,"1471":233,"1472":176,"1473":53,"1474":89,"1475":4,"1476":90,"1477":227,"1478":176,"1479":235,"1480":121,"1481":82,"1482":69,"1483":190,"1484":118,"1485":14,"1486":69,"1487":104,"1488":135,"1489":222,"1490":196,"1491":239,"1492":102,"1493":133,"1494":12,"1495":18,"1496":201,"1497":4,"1498":71,"1499":137,"1500":48,"1501":203,"1502":116,"1503":112,"1504":19,"1505":190,"1506":13,"1507":18,"1508":5,"1509":53,"1510":235,"1511":167,"1512":50,"1513":129,"1514":98,"1515":208,"1516":71,"1517":25,"1518":12,"1519":172,"1520":190,"1521":200,"1522":16,"1523":14,"1524":253,"1525":136,"1526":169,"1527":136,"1528":252,"1529":109,"1530":202,"1531":225,"1532":230,"1533":30,"1534":159,"1535":203,"1536":78,"1537":131,"1538":95,"1539":239,"1540":158,"1541":187,"1542":114,"1543":67,"1544":149,"1545":198,"1546":94,"1547":96,"1548":235,"1549":222,"1550":65,"1551":248,"1552":216,"1553":199,"1554":214,"1555":59,"1556":162,"1557":48,"1558":17,"1559":139,"1560":33,"1561":79,"1562":190,"1563":9,"1564":194,"1565":218,"1566":155,"1567":1,"1568":5,"1569":170,"1570":218,"1571":22,"1572":179,"1573":40,"1574":117,"1575":185,"1576":216,"1577":206,"1578":167,"1579":31,"1580":134,"1581":226,"1582":156,"1583":173,"1584":238,"1585":233,"1586":25,"1587":68,"1588":58,"1589":218,"1590":10,"1591":75,"1592":225,"1593":56,"1594":24,"1595":38,"1596":220,"1597":37,"1598":213,"1599":10,"1600":202,"1601":112,"1602":28,"1603":227,"1604":65,"1605":245,"1606":1,"1607":184,"1608":59,"1609":32,"1610":33,"1611":133,"1612":156,"1613":25,"1614":156,"1615":221,"1616":13,"1617":46,"1618":195,"1619":66,"1620":53,"1621":63,"1622":41,"1623":78,"1624":228,"1625":248,"1626":147,"1627":27,"1628":36,"1629":9,"1630":163,"1631":84,"1632":224,"1633":94,"1634":34,"1635":189,"1636":3,"1637":129,"1638":192,"1639":103,"1640":176,"1641":85,"1642":134,"1643":82,"1644":82,"1645":130,"1646":115,"1647":45,"1648":210,"1649":146,"1650":171,"1651":0,"1652":90,"1653":127,"1654":109,"1655":238,"1656":87,"1657":194,"1658":253,"1659":179,"1660":111,"1661":88,"1662":91,"1663":17,"1664":27,"1665":242,"1666":231,"1667":226,"1668":133,"1669":235,"1670":71,"1671":17,"1672":161,"1673":224,"1674":129,"1675":55,"1676":61,"1677":109,"1678":30,"1679":4,"1680":169,"1681":56,"1682":168,"1683":251,"1684":51,"1685":117,"1686":100,"1687":144,"1688":178,"1689":170,"1690":169,"1691":202,"1692":19,"1693":244,"1694":72,"1695":117}'
		});
	}).as('fetchMyKeys');

	cy.intercept('POST', '/api/v1/e2e.setUserPublicAndPrivateKeys', (req) => {
		req.reply({
			success: true
		});
	}).as('setUserPublicAndPrivateKeys');
});

Cypress.Commands.add(
	'fastLogin',
	(
		args: LoginArgs = {
			username: USER_ASKER
		}
	) => {
		username = args.username || USER_ASKER;

		cy.fixture('api.v1.login').then((res) => {
			if (res.data.authToken) {
				cy.setCookie('rc_token', res.data.authToken);
			}
			if (res.data.userId) {
				cy.setCookie('rc_uid', res.data.userId);
			}
		});

		const tomorrow = new Date();
		tomorrow.setDate(tomorrow.getDate() + 1);

		window.localStorage.setItem(
			'auth.access_token_valid_until',
			tomorrow.getTime().toString()
		);
		window.localStorage.setItem(
			'auth.refresh_token_valid_until',
			tomorrow.getTime().toString()
		);

		cy.visit('/app');
		cy.wait('@usersData');
		if (username === USER_ASKER) {
			cy.wait('@askerSessions');
		} else {
			cy.wait('@consultantEnquiriesBase');
		}
	}
);
