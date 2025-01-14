const api = new Map();

api.set("PUBLIC_API_HOST", "https://api.alimanager.ru");
api.set("DEV_API_HOST", "http://alimanager-server.web");
api.set("API_v1", "/api/cabinet/v1");

// страница отслеживания посылки
const trackUrl = "https://www.aliexpress.com/p/tracking/index.html?alimanager=track-number&tradeOrderId=";
const listOrdersUrl = "https://aliexpress.ru/order-list";
const orderUrl = "https://aliexpress.ru/order-list/";

let activeTab = null;
let orders = null;
let ordersData = [];
let indexOrder = 0;

const trackings = new Map();

chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
	// запуск поиска
	if (request.startSearch) {
		await chrome.tabs
			.create({
				url: listOrdersUrl,
			})
			.then((tab) => (activeTab = tab));

		await addFilesTab(activeTab, ["./temp/dates.js", "./temp/controller.js"]);

		// запись даты последнего поиска
		setDateSearch();
	}

	// дата заказа
	if (request.startCompareOrderDate) {
		await chrome.tabs
			.create({
				url: orderUrl + request.startCompareOrderDate.orderNumber + "?date=" + request.startCompareOrderDate.date,
			})
			.then((tab) => {
				addFilesTab(tab, ["./temp/order-date.js"]);
			});
	}

	// получает список заказов и запускает сбор данных
	// открываем сразу страницу с логином, иначе если открыть просто страницу с заказом, то встраиваемый скрипт не будет работать
	if (request.ordersComplete) {
		orders = await getStorage("orders");

		if (orders) {
			chrome.tabs.update(activeTab.id, {
				url:
					"https://login.aliexpress.ru/?flag=1&return_url=https%3A%2F%2Faliexpress.ru%2Forder-list%2F" +
					orders[0].orderNumber +
					"%3Falimanager%3Dorder",
			});
		}
	}

	// Получает данные о заказе
	// все заказы записываем в массив
	// когда получены все заказы, то записываем в storage и закрываем активную вкладку
	// а так же запускаем сбор трек-кодов посылок
	if (request.orderDataComplete) {
		ordersData.push(request.orderDataComplete);

		if (indexOrder === orders.length - 1) {
			// 1. закрываем активную вкладку после получения данных о заказах
			chrome.tabs.remove(activeTab.id, () => {
				activeTab = null;
				indexOrder = 0;
				setStorage("ordersData", ordersData);
			});

			// !!! - можно сделать опционально
			// 2. запуск сбор трек-кодов отслеживания посылок
			startGetOrdersTrackNumbers();
		} else {
			indexOrder++;
			getOrderData();
		}
	}

	// получает трек-коды отслеживания посылок
	if (request.orderTrackingNumbersComplete) {
		let result = request.orderTrackingNumbersComplete;

		if (!orders) {
			orders = await getStorage("orders");
		}

		trackings.set(orders[indexOrder].orderNumber, {
			original: result.original,
		});

		if (indexOrder === orders.length - 1) {
			chrome.tabs.remove(activeTab.id, async () => {
				activeTab = null;
				indexOrder = 0;

				await addTrackingsToOrders();
				//await sendResult();
			});
		} else {
			indexOrder++;
			getOrderTrackNumbers();
		}
	}
});

chrome.tabs.onCreated.addListener(async () => {
	await chrome.tabs.query({ active: true }).then((tabs) => (activeTab = tabs[0]));

	let page = getUriParams(activeTab, "alimanager");
	let pageStatus = activeTab.status;

	console.log("787878");

	// страница трек-кода посылки
	// if (page === "track-number" && pageStatus === "complete") {
	// 	addFilesTab(activeTab, ["./temp/tracking-number.js"]);
	// }
});

chrome.tabs.onUpdated.addListener(async () => {
	// обновение данных активной вкладки
	await chrome.tabs.query({ active: true }).then((tabs) => (activeTab = tabs[0]));

	let page = getUriParams(activeTab, "alimanager");
	let pageStatus = activeTab.status;

	if (page === "order") {
		console.log(pageStatus);
	}

	// страница данных о заказе - RU версия
	if (page === "order" && pageStatus === "complete") {
		addFilesTab(activeTab, ["./temp/order-ru.js"]);
	}

	// страница трек-кода посылки
	if (page === "track-number" && pageStatus === "complete") {
		addFilesTab(activeTab, ["./temp/tracking-number.js"]);
	}
});

function sendResult() {
	return new Promise(async (resolve) => {
		const orders = await getStorage("ordersData");
		//const authToken = await getStorage("authToken");
		const user = await getStorage("user");

		//!authToken ||
		if (!user || !user.email || !orders) {
			return false;
		}

		const data = {
			orders: orders,
			email: user.email,
		};

		fetch(api.get("DEV_API_HOST") + api.get("API_v1") + "/result-search-orders", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				//Authorization: "Bearer " + authToken,
			},
			body: JSON.stringify(data),
		})
			.then((response) => response.text())
			.then((data) => {
				if (!data) {
					throw new Exception();
				}
				setStorage("codeResultSearchOrders", data);
			})
			.catch((error) => {
				console.log(error);
			});

		resolve();
	});
}

// setTimeout(async () => {
// 	await sendResult();
// }, 5000);

/**
 * Выполняет скрипт из указанной вкладки.
 *
 * @param {Object} tab - Объект вкладки, в которой будет выполнен скрипт.
 * @param {Array} files - Массив путей к файлам скриптов для выполнения.
 * @return {Promise}
 */

function addFilesTab(tab, files) {
	return chrome.scripting.executeScript({
		target: { tabId: tab.id },
		files: files,
	});
}

function setDateSearch() {
	let dateNow = new Date();
	let dateLastSearch =
		dateNow.getDate() + "." + (dateNow.getMonth() + 1) + "." + dateNow.getFullYear() + " " + dateNow.getHours() + ":" + dateNow.getMinutes();

	setStorage("lastSearchOrders", dateLastSearch);
}

function getOrderData() {
	chrome.tabs.update(activeTab.id, { url: "https://aliexpress.ru/order-list/" + orders[indexOrder].orderNumber + "?alimanager=order" });
}

function startGetOrdersTrackNumbers() {
	chrome.tabs.create({
		url: trackUrl + orders[0].orderNumber,
	});
}

function getOrderTrackNumbers() {
	chrome.tabs.update(activeTab.id, { url: trackUrl + orders[indexOrder].orderNumber });
}

function addTrackingsToOrders() {
	return new Promise(async (resolve) => {
		// if (!ordersData) {
		// 	resolve();
		// 	return false;
		// }

		ordersData = await getStorage("ordersData");

		console.log(ordersData);

		let i = 0;

		ordersData.forEach((order) => {
			i++;

			order.trackings = trackings.get(order.number);

			if (ordersData.length == i) {
				setStorage("ordersData", ordersData);
				resolve();
			}
		});
	});
}

async function setStorage(key, value) {
	await chrome.storage.local.set({ [key]: value });
}

async function getStorage(key) {
	let value = null;

	await chrome.storage.local.get([key]).then((result) => (value = result[key]));

	return value;
}

function getUriParams(tab, param) {
	let url = null;

	if (tab.url) url = tab.url;
	if (tab.pendingUrl) url = tab.pendingUrl;

	if (!url) {
		return false;
	}

	let params = new URL(url).searchParams;
	return params.get(param);
}
