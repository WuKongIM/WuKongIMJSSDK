build:
	docker build -t wukongimdemo .
deploy:
	docker build -t wukongimdemo  .
	docker tag wukongimdemo wukongim/wukongimdemo:latest
	docker push wukongim/wukongimdemo:latest