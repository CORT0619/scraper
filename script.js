const scrapeSite = async url => {
	console.log('scraping site');
	const response = await fetch('', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ url })
	});
	const data = await response.json();
	console.log('data ', data);
};

(() => {
	const button = document.getElementById('submit');
	const input = document.getElementById('url');

	button.addEventListener('click', (e) => {
		const url = input.value;
		// scrapeSite(url);
	});
})();
