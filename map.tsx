'use client';
import { forwardRef } from 'react';
import { useEffect, useRef, useState } from 'react';
import L, { Content } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw';
import 'leaflet-geometryutil';
import 'leaflet-draw/dist/leaflet.draw.css';
import {
     formatLatLng,
     cleanJsonText,
     parseGRDPData,
     getUsedIndustries,
     saveUsedIndustry,
     parseCSV,
     parseUSCSV,
     determineLocationType,
} from './utils';
import '@/public/style/map-industry.css';
import { config } from './config';
import { GeminiAnalysisService, analyzeBusinessIdea } from './service';

declare module 'leaflet' {
     interface RectangleOptions {
          showArea?: boolean;
          metric?: boolean;
     }

     interface DrawEvents {
          Created: {
               layer: L.Rectangle | L.Polygon | L.Circle | L.Marker | L.CircleMarker;
               layerType: 'rectangle' | 'polygon' | 'circle' | 'marker' | 'circlemarker';
          };
     }
}

interface AnalysisResult {
     demographics: {
          density: number;
          ageGroups: {
               under18: number;
               age1834: number;
               age3559: number;
               above60: number;
          };
     };
     economics: {
          averageIncome: number;
          expenditure: {
               housing: number;
               food: number;
               education: number;
               entertainment: number;
               others: number;
          };
     };
     trends: {
          consumption: {
               foodBeverage: number;
               housing: number;
               transportation: number;
               healthcare: number;
               education: number;
               other: number;
          };
          production: {
               agriculture: number;
               manufacturing: number;
               services: number;
               construction: number;
          };
     };
}
type ChildProps = {
     className?: string;
};

const MapIndustry = forwardRef<HTMLDivElement, { className?: string }>((props, ref) => {
     // Xác định đường dẫn chính xác
     L.Icon.Default.mergeOptions({
          iconUrl: '/marker-icon.png',
          shadowUrl: '/marker-shadow.png',
     });
     let map: any;
     let searchMarker: any;
     let markers = new Map();
     let provinceData: Record<string, any> = {}; // Dữ liệu Việt Nam
     let usData: Record<string, any> = {}; // Dữ liệu Mỹ
     let isPinMode = false;
     let districtsData: Record<string, any> = {};

     type CountryCode = 'VN' | 'US';
     const countries: { name: string; code: CountryCode }[] = [
          { name: 'Việt Nam', code: 'VN' },
          { name: 'Mỹ', code: 'US' },
     ];

     // Data Loading Functions
     async function loadProvinceData() {
          try {
               // Load province base data
               const vnResponse = await fetch('/provinces.csv');
               const vnText = await vnResponse.text();
               provinceData = parseCSV(vnText);

               // Load GRDP data
               const grdpResponse = await fetch('/ket_qua_1.csv');
               const grdpText = await grdpResponse.text();
               const grdpData: Record<string, any> = parseGRDPData(grdpText);
               // Merge GRDP data into province data
               for (let provinceName in provinceData) {
                    if (grdpData[provinceName]) {
                         provinceData[provinceName].grdp = grdpData[provinceName];
                    }
               }

               // Load US data (keeping existing US data loading)
               const usResponse = await fetch('/US.csv');
               const usText = await usResponse.text();
               usData = parseUSCSV(usText);

               // Enable the countries button after data is loaded
               const toggleCountriesBtn = document.getElementById('toggleCountries') as HTMLButtonElement;
               if (toggleCountriesBtn) {
                    toggleCountriesBtn.disabled = false;
                    toggleCountriesBtn.title = '';
               }
          } catch (error) {
               console.error('Error loading data:', error);
               alert('Không thể tải dữ liệu. Vui lòng kiểm tra các file CSV.');
          }

          return null;
     }

     function organizeDistrictsByProvince(csvData: any) {
          const districts: Record<string, any> = {};
          const lines = csvData.trim().split('\n');

          // Bỏ qua dòng header
          for (let i = 1; i < lines.length; i++) {
               const line = lines[i].trim();
               if (!line) continue;

               const parts = line.split(',');
               const districtName = parts[0].trim();
               const provinceName = parts[1].trim();
               const lat = parseFloat(parts[2]);
               const lng = parseFloat(parts[3]);

               if (provinceName) {
                    if (!districts[provinceName]) {
                         districts[provinceName] = [];
                    }
                    districts[provinceName].push({
                         name: districtName,
                         coordinates: [lat, lng],
                    });
               }
          }
          return districts;
     }

     function saveBusinessIdea(locationData: any, idea: string) {
          let history = getBusinessIdeasHistory();
          const newIdea = {
               id: Date.now(),
               timestamp: new Date().toISOString(),
               location: {
                    name: locationData.name,
                    lat: locationData.lat,
                    lng: locationData.lng,
                    type: locationData.type,
               },
               idea: idea,
          };

          history.unshift(newIdea);
          localStorage.setItem(config.BUSINESS_IDEAS_KEY, JSON.stringify(history));
          return newIdea.id;
     }

     function getBusinessIdeasHistory() {
          const history = localStorage.getItem(config.BUSINESS_IDEAS_KEY);
          return history ? JSON.parse(history) : [];
     }

     function addPinControl() {
          const controlButtons = document.querySelector('.control-buttons');
          const pinButton = document.createElement('button');
          pinButton.className = 'control-button';
          pinButton.id = 'togglePin';
          pinButton.innerHTML = `
          <span>
               <svg fill="#000000" width="25px" height="25px" viewBox="0 0 32 32" version="1.1" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <title>pin</title> <path d="M20.5 15h-9c-1.104 0-2 0.896-2 2s0.896 2 2 2h9c1.104 0 2-0.896 2-2s-0.896-2-2-2zM13.583 8l-1.083 6h7l-1.084-6h-4.833zM16 29l1.5-9h-3l1.5 9zM13 7h6c0.828 0 1.5-0.672 1.5-1.5s-0.672-1.5-1.5-1.5h-6c-0.829 0-1.5 0.672-1.5 1.5s0.671 1.5 1.5 1.5z"></path> </g></svg>
          </span>
          Ghim vị trí`;
          if (controlButtons) controlButtons.insertBefore(pinButton, controlButtons.firstChild);

          // Thêm xử lý sự kiện cho nút Pin
          pinButton.addEventListener('click', function () {
               isPinMode = !isPinMode;
               this.classList.toggle('active');

               if (isPinMode) {
                    map.getContainer().style.cursor = 'crosshair';
               } else {
                    map.getContainer().style.cursor = '';
               }
          });

          // Thêm xử lý sự kiện click trên map
          map.on('click', async function (e: any) {
               if (!isPinMode) return;

               try {
                    const lat = e.latlng.lat;
                    const lng = e.latlng.lng;

                    // Hiển thị loading popup
                    const loadingPopup = L.popup()
                         .setLatLng(e.latlng)
                         .setContent('<div style="text-align: center; padding: 20px;">Đang phân tích địa điểm...</div>')
                         .openOn(map);

                    // Lấy thông tin địa điểm từ tọa độ
                    const locationInfo = await getLocationInfo(lat, lng);

                    // Phân tích địa điểm
                    const locationData = await analyzeLocation(locationInfo, lat, lng);

                    // Tạo marker và popup
                    if (searchMarker) {
                         map.removeLayer(searchMarker);
                    }

                    const popupContent = createSearchResultPopup(locationData);
                    searchMarker = L.marker([lat, lng], {
                         title: locationData.name,
                    })
                         .bindPopup(popupContent)
                         .addTo(map);

                    // Lưu vào lịch sử
                    saveSearchPoint(locationData);
                    // Đóng loading popup và mở popup kết quả
                    map.closePopup(loadingPopup);
                    searchMarker.openPopup();

                    // Tắt chế độ pin sau khi hoàn thành
                    isPinMode = false;
                    const togglePinBtn = document.getElementById('togglePin');
                    if (togglePinBtn) togglePinBtn.classList.remove('active');
                    map.getContainer().style.cursor = '';
               } catch (error: any) {
                    console.error('Pin location error:', error);
                    map.closePopup();
                    alert('Có lỗi xảy ra khi phân tích vị trí: ' + error.message);

                    // Tắt chế độ pin nếu có lỗi
                    isPinMode = false;
                    const togglePinBtn = document.getElementById('togglePin');
                    if (togglePinBtn) togglePinBtn.classList.remove('active');
                    map.getContainer().style.cursor = '';
               }
          });
     }

     async function analyzeLocation(locationInfo: any, lat: any, lng: any) {
          const prompt = `Hãy phân tích địa điểm "${locationInfo.name}" tại vị trí (${lat}, ${lng}).
Chỉ trả về theo định dạng JSON sau, không thêm text nào khác:
{
"name": "${locationInfo.name}",
"lat": ${lat},
"lng": ${lng},
"type": "${locationInfo.type}",
"sectors": [
  {
      "name": "tên ngành",
      "percentage": số_phần_trăm,
      "description": "mô tả ngắn về đặc điểm và vai trò của ngành này tại khu vực"
  }
],
"analysis": {
  "strengths": "điểm mạnh của khu vực",
  "weaknesses": "điểm yếu cần cải thiện",
  "challenges": "khó khăn cần giải quyết", 
  "requirements": "kiến thức và kỹ năng cần có"
}
}`;

          try {
               const response = await fetch(`${config.GEMINI_API_URL}?key=${config.GEMINI_API_KEY}`, {
                    method: 'POST',
                    headers: {
                         'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                         contents: [
                              {
                                   parts: [
                                        {
                                             text: prompt,
                                        },
                                   ],
                              },
                         ],
                         generationConfig: {
                              temperature: 0.1,
                              topP: 1,
                              topK: 1,
                         },
                    }),
               });

               const data = await response.json();

               if (!data.candidates || !data.candidates[0]?.content?.parts[0]?.text) {
                    throw new Error('Không nhận được dữ liệu phân tích từ API');
               }

               let jsonText = data.candidates[0].content.parts[0].text;
               jsonText = cleanJsonText(jsonText);

               let locationData = JSON.parse(jsonText);
               validateLocationData(locationData);

               // Đảm bảo giữ nguyên tọa độ
               locationData.lat = lat;
               locationData.lng = lng;

               return locationData;
          } catch (error) {
               console.error('Analyze location error:', error);
               throw new Error('Không thể phân tích địa điểm');
          }
     }

     // Xóa một ý tưởng
     function deleteBusinessIdea(ideaId: string) {
          let history = getBusinessIdeasHistory();
          history = history.filter((item: any) => item.id.toString() !== ideaId);
          localStorage.setItem(config.BUSINESS_IDEAS_KEY, JSON.stringify(history));
     }

     // Hàm lấy thông tin địa điểm từ tọa độ
     async function getLocationInfo(lat: any, lng: any) {
          try {
               const response = await fetch(
                    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=vi`,
               );

               if (!response.ok) {
                    throw new Error('Không thể lấy thông tin địa điểm');
               }

               const data = await response.json();

               // Xử lý thông tin địa điểm
               const address = data.address;
               const components = [];

               // Ưu tiên các thành phần địa chỉ theo thứ tự
               if (address.quarter) components.push(address.quarter);
               if (address.suburb) components.push(address.suburb);
               if (address.city_district) components.push(address.city_district);
               if (address.city) components.push(address.city);
               if (address.state) components.push(address.state);
               if (address.country) components.push(address.country);

               return {
                    name: components.join(', ') || 'Vị trí đã chọn',
                    type: determineLocationType(address),
                    raw: data,
               };
          } catch (error) {
               console.error('Get location info error:', error);
               return {
                    name: 'Vị trí đã chọn',
                    type: 'địa danh',
                    raw: null,
               };
          }
     }

     // Tạo prompt mới có tham khảo ý tưởng cũ

     function createBusinessPrompt(locationData: any, isVietnam: boolean) {
          if (!locationData || !locationData.lat || !locationData.lng) {
               throw new Error('Thiếu thông tin tọa độ địa điểm');
          }

          // Danh sách tất cả các ngành có thể
          const allIndustries = [
               'Công nghệ sinh học và y tế',
               'Năng lượng tái tạo',
               'Giáo dục và đào tạo',
               'Nông nghiệp thông minh',
               'Thương mại điện tử',
               'Logistics và vận tải',
               'Công nghiệp sản xuất',
               'Du lịch và giải trí',
               'Dịch vụ tài chính',
               'Bất động sản',
               'Công nghệ thông tin',
               'Y tế và chăm sóc sức khỏe',
               'Môi trường và tái chế',
               'Thực phẩm và đồ uống',
               'Xây dựng và vật liệu',
          ];

          // Lấy danh sách ngành đã sử dụng cho địa điểm này
          const usedIndustries = getUsedIndustries()[locationData.name] || [];
          // Lọc ra các ngành chưa được sử dụng
          const availableIndustries = allIndustries.filter((industry) => !usedIndustries.includes(industry));

          if (availableIndustries.length === 0) {
               const usedIndustriesCopy = { ...getUsedIndustries() };
               // Nếu đã sử dụng hết tất cả các ngành, reset lại
               delete usedIndustriesCopy[locationData.name];
               localStorage.setItem(config.USED_INDUSTRIES_KEY, JSON.stringify(usedIndustriesCopy));
               // return createBusinessPrompt(locationData, isVietnam); // Gọi lại hàm
               return;
          }

          // Chọn ngẫu nhiên một ngành chưa sử dụng
          const selectedIndustry = availableIndustries[Math.floor(Math.random() * availableIndustries.length)];

          // Lưu ngành đã chọn vào lịch sử
          saveUsedIndustry(locationData.name, selectedIndustry);

          // Lấy các ý tưởng đã có để tránh trùng lặp
          const previousIdeas = getBusinessIdeasHistory()
               .filter((item: any) => item.location && item.location.name === locationData.name)
               .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

          let previousIdeasText = '';
          if (previousIdeas.length > 0) {
               previousIdeasText = `
CÁC Ý TƯỞNG ĐÃ TỒN TẠI (TUYỆT ĐỐI TRÁNH TRÙNG LẶP):
${previousIdeas
     .map(
          (item: any, index: number) => `
  ${index + 1}. ${item.idea.businessIdea.name}
  - Mô tả: ${item.idea.businessIdea.description}
  - Đối tượng: ${item.idea.businessIdea.businessModel.targetCustomer}
`,
     )
     .join('\n')}
`;
          }

          return `Hãy đề xuất một ý tưởng kinh doanh cho ${locationData.name} trong lĩnh vực ${selectedIndustry}.

THÔNG TIN KHU VỰC:
- Dân số: ${locationData.population ? locationData.population.toLocaleString() : 'N/A'} người
- Thu nhập: ${locationData.income || 'N/A'} ${isVietnam ? 'triệu đồng/tháng' : 'USD/năm'}
- Ngành chính: ${Array.isArray(locationData.sectors) ? locationData.sectors.join(', ') : 'N/A'}
- Xu hướng: ${Array.isArray(locationData.trends) ? locationData.trends.join(', ') : 'N/A'}

${previousIdeasText}

YÊU CẦU NGHIÊM NGẶT:
1. Ý tưởng PHẢI thuộc lĩnh vực: ${selectedIndustry}
2. TUYỆT ĐỐI KHÔNG ĐƯỢC có bất kỳ sự trùng lặp nào với các ý tưởng cũ
3. Phải mang tính đột phá và sáng tạo trong lĩnh vực được chỉ định
4. Phải phù hợp với đặc điểm địa phương và xu hướng phát triển

Trả về kết quả theo định dạng JSON:
{
"businessIdea": {
  "name": "Tên ý tưởng (phải bắt đầu bằng: ${selectedIndustry})",
  "description": "Mô tả chi tiết về ý tưởng",
  "businessModel": {
      "overview": "Tổng quan về mô hình kinh doanh",
      "targetCustomer": "Đối tượng khách hàng mục tiêu",
      "valueProposition": "Giá trị độc đáo mang lại cho khách hàng",
      "revenueStreams": "Các nguồn thu chính"
  },
  "challenges": [
      {
          "challenge": "Thách thức cụ thể",
          "solution": "Giải pháp chi tiết"
      }
  ],
  "implementationSteps": [
      "Các bước triển khai cụ thể"
  ]
}
}`;
     }

     // Hàm hỗ trợ phân tích ý tưởng
     function extractMainCategory(name: string) {
          // Rút trích lĩnh vực chính từ tên ý tưởng
          const categories = [
               'dịch vụ',
               'sản xuất',
               'thương mại',
               'du lịch',
               'công nghệ',
               'giáo dục',
               'y tế',
               'nông nghiệp',
          ];
          return categories.find((cat) => name.toLowerCase().includes(cat)) || 'khác';
     }

     function extractKeywords(text: string) {
          // Rút trích từ khóa quan trọng từ mô tả
          const words = text.toLowerCase().split(' ');
          return [...new Set(words.filter((w) => w.length > 5))].slice(0, 5);
     }

     function identifyBusinessType(description: string) {
          // Xác định loại hình kinh doanh
          const types = ['B2C', 'B2B', 'C2C', 'dịch vụ', 'sản xuất', 'thương mại'];
          return types.find((type) => description.toLowerCase().includes(type)) || 'khác';
     }

     // AreaAnalysis Object
     const AreaAnalysis = {
          drawnItems: null as L.FeatureGroup | null,
          isAnalysisMode: false,
          map: null as L.Map | null,
          drawControl: null as L.Control.Draw | null,
          currentLayer: null as L.Layer | null,

          initialize(map: L.Map) {
               this.map = map;
               this.drawnItems = new L.FeatureGroup();
               map.addLayer(this.drawnItems);
               this.initializeDrawControl();
               this.initializeAnalysisMode();
          },

          initializeDrawControl() {
               if (!this.drawnItems) return;
               this.drawControl = new L.Control.Draw({
                    draw: {
                         rectangle: {
                              shapeOptions: {
                                   color: '#4CAF50',
                                   weight: 2,
                              },
                              metric: true,
                              showArea: true,
                         } as L.DrawOptions.RectangleOptions,
                         polygon: false,
                         polyline: false,
                         circle: false,
                         marker: false,
                         circlemarker: false,
                    },
                    edit: {
                         featureGroup: this.drawnItems,
                         remove: true,
                    },
               });
          },

          async getLocationName(center: L.LatLng) {
               try {
                    const response = await fetch(
                         `https://nominatim.openstreetmap.org/reverse?lat=${center.lat}&lon=${center.lng}&format=json&accept-language=vi`,
                    );

                    if (!response.ok) {
                         throw new Error('Không thể lấy thông tin địa điểm');
                    }

                    const data = await response.json();
                    const address = data.address;
                    const components = [];

                    if (address.quarter) components.push(address.quarter);
                    if (address.suburb) components.push(address.suburb);
                    if (address.city_district) components.push(address.city_district);
                    if (address.city) components.push(address.city);
                    if (address.state) components.push(address.state);

                    return components.join(', ') || 'Khu vực chưa xác định';
               } catch (error) {
                    console.error('Lỗi lấy tên địa điểm:', error);
                    return 'Khu vực chưa xác định';
               }
          },

          initializeAnalysisMode() {
               if (!this.map || !this.drawnItems) return;
               this.map.on('draw:created', async (e: any) => {
                    const layer = e.layer;
                    this.drawnItems?.addLayer(layer);
                    this.currentLayer = layer;

                    if (this.isAnalysisMode && e.layerType === 'rectangle') {
                         try {
                              const rectangleLayer = layer as L.Rectangle;
                              const bounds = rectangleLayer.getBounds();
                              const center = bounds.getCenter();
                              const area = this.calculateRectangleArea(bounds);
                              if (this.map) {
                                   const loadingPopup = L.popup()
                                        .setLatLng(center)
                                        .setContent('<div class="loading">Đang phân tích...</div>')
                                        .openOn(this.map);

                                   const locationName = await this.getLocationName(center);

                                   const analysisResult = await GeminiAnalysisService.analyzeRegion(
                                        [center.lat, center.lng],
                                        area / 1000000,
                                   );

                                   this.map?.closePopup(loadingPopup);

                                   const popupContent = this.createAnalysisPopup(
                                        analysisResult,
                                        area,
                                        bounds,
                                        locationName,
                                   );

                                   layer.bindPopup(popupContent, {
                                        maxWidth: 400,
                                        className: 'analysis-popup-container',
                                   }).openPopup();
                              }
                         } catch (error: any) {
                              console.error('Analysis error:', error);
                              layer.bindPopup(
                                   `<div class="error-popup">Lỗi phân tích khu vực: ${error.message}</div>`,
                              ).openPopup();
                         }
                    }
               });
          },

          calculateRectangleArea(bounds: L.LatLngBounds) {
               const northWest = bounds.getNorthWest();
               const northEast = bounds.getNorthEast();
               const southEast = bounds.getSouthEast();
               const southWest = bounds.getSouthWest();

               return (L.GeometryUtil as any).geodesicArea([northWest, northEast, southEast, southWest]);
          },

          createAnalysisPopup(analysis: any, area: number, bounds: L.LatLngBounds, locationName: string) {
               const center = bounds.getCenter();

               return `
      <div class="analysis-popup">
          <h4 class="text-xl font-bold">Thông tin khu vực phân tích</h4>
          <div class="analysis-popup-content">
              <div class="info-section">
                  <div class="info-section-title">
                     <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6">
  <path fill-rule="evenodd" d="m11.54 22.351.07.04.028.016a.76.76 0 0 0 .723 0l.028-.015.071-.041a16.975 16.975 0 0 0 1.144-.742 19.58 19.58 0 0 0 2.683-2.282c1.944-1.99 3.963-4.98 3.963-8.827a8.25 8.25 0 0 0-16.5 0c0 3.846 2.02 6.837 3.963 8.827a19.58 19.58 0 0 0 2.682 2.282 16.975 16.975 0 0 0 1.145.742ZM12 13.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clip-rule="evenodd" />
</svg>


                      <h5>Địa điểm</h5>
                  </div>
                  <div class="info-item">
                      <div class="info-value" style="padding: 8px 0; font-weight: 500;">
                          ${locationName}
                      </div>
                  </div>
              </div>

              <div class="info-section">
                  <div class="info-section-title">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6">
  <path d="M11.644 1.59a.75.75 0 0 1 .712 0l9.75 5.25a.75.75 0 0 1 0 1.32l-9.75 5.25a.75.75 0 0 1-.712 0l-9.75-5.25a.75.75 0 0 1 0-1.32l9.75-5.25Z" />
  <path d="m3.265 10.602 7.668 4.129a2.25 2.25 0 0 0 2.134 0l7.668-4.13 1.37.739a.75.75 0 0 1 0 1.32l-9.75 5.25a.75.75 0 0 1-.71 0l-9.75-5.25a.75.75 0 0 1 0-1.32l1.37-.738Z" />
  <path d="m10.933 19.231-7.668-4.13-1.37.739a.75.75 0 0 0 0 1.32l9.75 5.25c.221.12.489.12.71 0l9.75-5.25a.75.75 0 0 0 0-1.32l-1.37-.738-7.668 4.13a2.25 2.25 0 0 1-2.134-.001Z" />
</svg>

                      <h5>Vị trí và diện tích</h5>
                  </div>
                  <div class="info-item">
                      <div class="info-label">Điểm trung tâm</div>
                      <div class="info-value">${formatLatLng(center)}</div>
                  </div>
                  <div class="info-item">
                      <div class="info-label">Diện tích</div>
                      <div class="info-value">${(area / 1000000).toFixed(2)} km²</div>
                  </div>
                  <div class="coordinate-details">
                      <div class="info-label">Tọa độ các góc:</div>
                      <div class="coordinate-grid">
                          <div class="coordinate-item">
                              <span>Tây Bắc:</span>
                              <span>${formatLatLng(bounds.getNorthWest())}</span>
                          </div>
                          <div class="coordinate-item">
                              <span>Đông Bắc:</span>
                              <span>${formatLatLng(bounds.getNorthEast())}</span>
                          </div>
                          <div class="coordinate-item">
                              <span>Đông Nam:</span>
                              <span>${formatLatLng(bounds.getSouthEast())}</span>
                          </div>
                          <div class="coordinate-item">
                              <span>Tây Nam:</span>
                              <span>${formatLatLng(bounds.getSouthWest())}</span>
                          </div>
                      </div>
                  </div>
              </div>

              <div class="info-section">
                  <div class="info-section-title">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6">
  <path fill-rule="evenodd" d="M8.25 6.75a3.75 3.75 0 1 1 7.5 0 3.75 3.75 0 0 1-7.5 0ZM15.75 9.75a3 3 0 1 1 6 0 3 3 0 0 1-6 0ZM2.25 9.75a3 3 0 1 1 6 0 3 3 0 0 1-6 0ZM6.31 15.117A6.745 6.745 0 0 1 12 12a6.745 6.745 0 0 1 6.709 7.498.75.75 0 0 1-.372.568A12.696 12.696 0 0 1 12 21.75c-2.305 0-4.47-.612-6.337-1.684a.75.75 0 0 1-.372-.568 6.787 6.787 0 0 1 1.019-4.38Z" clip-rule="evenodd" />
  <path d="M5.082 14.254a8.287 8.287 0 0 0-1.308 5.135 9.687 9.687 0 0 1-1.764-.44l-.115-.04a.563.563 0 0 1-.373-.487l-.01-.121a3.75 3.75 0 0 1 3.57-4.047ZM20.226 19.389a8.287 8.287 0 0 0-1.308-5.135 3.75 3.75 0 0 1 3.57 4.047l-.01.121a.563.563 0 0 1-.373.486l-.115.04c-.567.2-1.156.349-1.764.441Z" />
</svg>

                      <h5>Dân số</h5>
                  </div>
                  <div class="stat-item" title="Mật độ dân số trên km²">
                      <div class="stat-label">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6">
  <path d="M4.5 6.375a4.125 4.125 0 1 1 8.25 0 4.125 4.125 0 0 1-8.25 0ZM14.25 8.625a3.375 3.375 0 1 1 6.75 0 3.375 3.375 0 0 1-6.75 0ZM1.5 19.125a7.125 7.125 0 0 1 14.25 0v.003l-.001.119a.75.75 0 0 1-.363.63 13.067 13.067 0 0 1-6.761 1.873c-2.472 0-4.786-.684-6.76-1.873a.75.75 0 0 1-.364-.63l-.001-.122ZM17.25 19.128l-.001.144a2.25 2.25 0 0 1-.233.96 10.088 10.088 0 0 0 5.06-1.01.75.75 0 0 0 .42-.643 4.875 4.875 0 0 0-6.957-4.611 8.586 8.586 0 0 1 1.71 5.157v.003Z" />
</svg>

                          Mật độ
                      </div>
                      <div class="stat-bar">
                          <div class="stat-progress" style="width: ${((analysis.demographics.density / 5000) * 100).toFixed(1)}%"></div>
                      </div>
                      <div class="stat-value">${analysis.demographics.density}/km²</div>
                  </div>
                  
                  <div class="age-distribution">
                      <div class="info-label">Phân bố độ tuổi:</div>
                      <div class="stat-item">
                          <div class="stat-label">Dưới 18</div>
                          <div class="stat-bar">
                              <div class="stat-progress" style="width: ${analysis.demographics.ageGroups.under18}%"></div>
                          </div>
                          <div class="stat-value">${analysis.demographics.ageGroups.under18}%</div>
                      </div>
                      <div class="stat-item">
                          <div class="stat-label">18-34</div>
                          <div class="stat-bar">
                              <div class="stat-progress" style="width: ${analysis.demographics.ageGroups.age1834}%"></div>
                          </div>
                          <div class="stat-value">${analysis.demographics.ageGroups.age1834}%</div>
                      </div>
                      <div class="stat-item">
                          <div class="stat-label">35-59</div>
                          <div class="stat-bar">
                              <div class="stat-progress" style="width: ${analysis.demographics.ageGroups.age3559}%"></div>
                          </div>
                          <div class="stat-value">${analysis.demographics.ageGroups.age3559}%</div>
                      </div>
                      <div class="stat-item">
                          <div class="stat-label">Trên 60</div>
                          <div class="stat-bar">
                              <div class="stat-progress" style="width: ${analysis.demographics.ageGroups.above60}%"></div>
                          </div>
                          <div class="stat-value">${analysis.demographics.ageGroups.above60}%</div>
                      </div>
                  </div>
              </div>

              <div class="info-section">
                  <div class="info-section-title">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6">
  <path d="M10.464 8.746c.227-.18.497-.311.786-.394v2.795a2.252 2.252 0 0 1-.786-.393c-.394-.313-.546-.681-.546-1.004 0-.323.152-.691.546-1.004ZM12.75 15.662v-2.824c.347.085.664.228.921.421.427.32.579.686.579.991 0 .305-.152.671-.579.991a2.534 2.534 0 0 1-.921.42Z" />
  <path fill-rule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM12.75 6a.75.75 0 0 0-1.5 0v.816a3.836 3.836 0 0 0-1.72.756c-.712.566-1.112 1.35-1.112 2.178 0 .829.4 1.612 1.113 2.178.502.4 1.102.647 1.719.756v2.978a2.536 2.536 0 0 1-.921-.421l-.879-.66a.75.75 0 0 0-.9 1.2l.879.66c.533.4 1.169.645 1.821.75V18a.75.75 0 0 0 1.5 0v-.81a4.124 4.124 0 0 0 1.821-.749c.745-.559 1.179-1.344 1.179-2.191 0-.847-.434-1.632-1.179-2.191a4.122 4.122 0 0 0-1.821-.75V8.354c.29.082.559.213.786.393l.415.33a.75.75 0 0 0 .933-1.175l-.415-.33a3.836 3.836 0 0 0-1.719-.755V6Z" clip-rule="evenodd" />
</svg>

                      <h5>Kinh tế</h5>
                  </div>
                  <div class="income-info">
                      <div class="info-item highlight-item">
                          <div class="info-label">Thu nhập trung bình hàng tháng</div>
                          <div class="info-value highlight-value">
                              ${analysis.economics.averageIncome.toLocaleString()} VNĐ
                          </div>
                      </div>
                  </div>

                  <div class="expenditure-stats">
                      <div class="info-label">Tỷ lệ chi tiêu:</div>
                      <div class="stat-item">
                          <div class="stat-label">Nhà ở</div>
                          <div class="stat-bar">
                              <div class="stat-progress" style="width: ${analysis.economics.expenditure.housing}%"></div>
                          </div>
                          <div class="stat-value">${analysis.economics.expenditure.housing}%</div>
                      </div>
                      <div class="stat-item">
                          <div class="stat-label">Thực phẩm</div>
                          <div class="stat-bar">
                              <div class="stat-progress" style="width: ${analysis.economics.expenditure.food}%"></div>
                          </div>
                          <div class="stat-value">${analysis.economics.expenditure.food}%</div>
                      </div>
                      <div class="stat-item">
                          <div class="stat-label">Giáo dục</div>
                          <div class="stat-bar">
                              <div class="stat-progress" style="width: ${analysis.economics.expenditure.education}%"></div>
                          </div>
                          <div class="stat-value">${analysis.economics.expenditure.education}%</div>
                      </div>
                      <div class="stat-item">
                          <div class="stat-label">Giải trí</div>
                          <div class="stat-bar">
                              <div class="stat-progress" style="width: ${analysis.economics.expenditure.entertainment}%"></div>
                          </div>
                          <div class="stat-value">${analysis.economics.expenditure.entertainment}%</div>
                      </div>
                      <div class="stat-item">
                          <div class="stat-label">Khác</div>
                          <div class="stat-bar">
                              <div class="stat-progress" style="width: ${analysis.economics.expenditure.others}%"></div>
                          </div>
                          <div class="stat-value">${analysis.economics.expenditure.others}%</div>
                      </div>
                  </div>
              </div>

              <div class="info-section">
                  <div class="info-section-title">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6">
  <path fill-rule="evenodd" d="M15.22 6.268a.75.75 0 0 1 .968-.431l5.942 2.28a.75.75 0 0 1 .431.97l-2.28 5.94a.75.75 0 1 1-1.4-.537l1.63-4.251-1.086.484a11.2 11.2 0 0 0-5.45 5.173.75.75 0 0 1-1.199.19L9 12.312l-6.22 6.22a.75.75 0 0 1-1.06-1.061l6.75-6.75a.75.75 0 0 1 1.06 0l3.606 3.606a12.695 12.695 0 0 1 5.68-4.974l1.086-.483-4.251-1.632a.75.75 0 0 1-.432-.97Z" clip-rule="evenodd" />
</svg>

                      <h5>Xu hướng</h5>
                  </div>
                  
                  <div class="trend-section">
                      <div class="info-label">Tiêu dùng chính:</div>
                      <div class="stat-item">
                          <div class="stat-label">Thực phẩm & Đồ uống</div>
                          <div class="stat-bar">
                              <div class="stat-progress" style="width: ${analysis.trends.consumption.foodBeverage}%"></div>
                          </div>
                          <div class="stat-value">${analysis.trends.consumption.foodBeverage}%</div>
                      </div>
                      <div class="stat-item">
                          <div class="stat-label">Nhà ở</div>
                          <div class="stat-bar">
                              <div class="stat-progress" style="width: ${analysis.trends.consumption.housing}%"></div>
                          </div>
                          <div class="stat-value">${analysis.trends.consumption.housing}%</div>
                      </div>
                      <div class="stat-item">
                          <div class="stat-label">Giao thông</div>
                          <div class="stat-bar">
                              <div class="stat-progress" style="width: ${analysis.trends.consumption.transportation}%"></div>
                          </div>
                          <div class="stat-value">${analysis.trends.consumption.transportation}%</div>
                      </div>
                      <div class="stat-item">
                          <div class="stat-label">Y tế</div>
                          <div class="stat-bar">
                              <div class="stat-progress" style="width: ${analysis.trends.consumption.healthcare}%"></div>
                          </div>
                          <div class="stat-value">${analysis.trends.consumption.healthcare}%</div>
                      </div>
                      <div class="stat-item">
                          <div class="stat-label">Giáo dục</div>
                          <div class="stat-bar">
                              <div class="stat-progress" style="width: ${analysis.trends.consumption.education}%"></div>
                          </div>
                          <div class="stat-value">${analysis.trends.consumption.education}%</div>
                      </div>
                      <div class="stat-item">
                          <div class="stat-label">Khác</div>
                          <div class="stat-bar">
                              <div class="stat-progress" style="width: ${analysis.trends.consumption.other}%"></div>
                          </div>
                          <div class="stat-value">${analysis.trends.consumption.other}%</div>
                      </div>
                  </div>

                  <div class="trend-section">
                      <div class="info-label">Sản xuất chính:</div>
                      <div class="stat-item">
                          <div class="stat-label">Nông nghiệp</div>
                          <div class="stat-bar">
                              <div class="stat-progress" style="width: ${analysis.trends.production.agriculture}%"></div>
                          </div>
                          <div class="stat-value">${analysis.trends.production.agriculture}%</div>
                      </div>
                      <div class="stat-item">
                          <div class="stat-label">Sản xuất</div>
                          <div class="stat-bar">
                              <div class="stat-progress" style="width: ${analysis.trends.production.manufacturing}%"></div>
                          </div>
                          <div class="stat-value">${analysis.trends.production.manufacturing}%</div>
                      </div>
                      <div class="stat-item">
                          <div class="stat-label">Dịch vụ</div>
                          <div class="stat-bar">
                              <div class="stat-progress" style="width: ${analysis.trends.production.services}%"></div>
                          </div>
                          <div class="stat-value">${analysis.trends.production.services}%</div>
                      </div>
                      <div class="stat-item">
                          <div class="stat-label">Xây dựng</div>
                          <div class="stat-bar">
                              <div class="stat-progress" style="width: ${analysis.trends.production.construction}%"></div>
                          </div>
                          <div class="stat-value">${analysis.trends.production.construction}%</div>
                      </div>
                  </div>
              </div>
          </div>
      </div>`;
          },

          toggleAnalysisMode() {
               this.isAnalysisMode = !this.isAnalysisMode;

               if (this.isAnalysisMode && this.map && this.drawControl) {
                    this.map.addControl(this.drawControl);
               } else if (this.map && this.drawControl) {
                    this.map.removeControl(this.drawControl);
                    this.clearDrawings();
               }
          },

          clearDrawings() {
               this.drawnItems?.clearLayers();
          },
     };

     // Map Initialization and Control Functions
     function initializeMap() {
          const mapContainer = document.getElementById('map');
          if (!mapContainer || typeof window === 'undefined') return;

          map = L.map('map', {
               center: [16.047079, 108.20623],
               zoom: 6,
          });

          L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
               attribution: 'Tiles &copy; Esri',
               maxZoom: 19,
          }).addTo(map);

          L.tileLayer(
               'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
               {
                    attribution: 'Labels &copy; Esri',
                    maxZoom: 19,
               },
          ).addTo(map);

          AreaAnalysis.initialize(map);

          map.on('popupopen', function (e: any) {
               // Gán lại các sự kiện cho các phần tử bên trong popup
               setTimeout(() => {
                    const analyzeBusinessBtn = document.getElementById('analyze-business-btn') as HTMLButtonElement;
                    if (analyzeBusinessBtn) {
                         analyzeBusinessBtn.addEventListener('click', () => handleSearchBusinessAnalysis());
                    }
                    const showBusinessHistoryBtn = document.getElementById(
                         'show-business-history-btn',
                    ) as HTMLButtonElement;
                    if (showBusinessHistoryBtn && searchMarker) {
                         showBusinessHistoryBtn.addEventListener('click', () => {
                              console.log('Hello', searchMarker);
                              console.log('003');
                              showBusinessHistory(searchMarker.getLatLng().lat, searchMarker.getLatLng().lng);
                         });
                    }
                    const handleSearchBusinessAnalysisBtn = document.getElementById(
                         'handle-search-business-btn',
                    ) as HTMLButtonElement;
                    if (handleSearchBusinessAnalysisBtn) {
                         handleSearchBusinessAnalysisBtn.addEventListener('click', () =>
                              handleSearchBusinessAnalysis(),
                         );
                    }
                    // const showDistrictBtn = document.getElementById('show-district-btn') as HTMLButtonElement;
                    // if (showDistrictBtn) {
                    //      showDistrictBtn.addEventListener('click', () => {
                    //           console.log('Hes');
                    //      });
                    // }
                    // const showBusinessBtn = document.getElementById('show-business-btn');
                    // if (showBusinessBtn) {
                    //      showBusinessBtn.addEventListener('click', () => showBusinessAnalysis(locationName, isVietnam));
                    // }
               }, 0);
          });
     }

     async function searchLocation() {
          const searchInput = document.getElementById('searchInput') as HTMLInputElement;
          const loadingSpan = document.getElementById('loading') as HTMLSpanElement;
          const searchTerm = searchInput.value.trim();
          if (!searchTerm) return;

          try {
               loadingSpan.style.display = 'inline';

               // Thử tìm kiếm với từ khóa Việt Nam trước
               let nominatimResponse = await fetch(
                    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchTerm + ' Việt Nam')}&format=json&limit=1&countrycodes=vn`,
               );

               if (!nominatimResponse.ok) {
                    throw new Error('Không thể kết nối đến dịch vụ tìm kiếm');
               }

               let nominatimData = await nominatimResponse.json();
               // Nếu không tìm thấy, thử tìm không giới hạn quốc gia
               if (!nominatimData || nominatimData.length === 0) {
                    nominatimResponse = await fetch(
                         `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchTerm)}&format=json&limit=1`,
                    );
                    nominatimData = await nominatimResponse.json();
               }

               // Nếu vẫn không tìm thấy
               if (!nominatimData || nominatimData.length === 0) {
                    throw new Error('Không tìm thấy địa điểm, vui lòng thử tìm kiếm với từ khóa khác');
               }

               const location = nominatimData[0];
               const lat = parseFloat(location.lat);
               const lng = parseFloat(location.lon);

               // Xác định loại địa điểm
               let locationType = 'địa danh';
               if (location.type === 'administrative' && location.class === 'boundary') {
                    if (location.type === 'city' || location.type === 'municipality') {
                         locationType = 'thành phố';
                    } else if (location.type === 'province') {
                         locationType = 'tỉnh';
                    }
               }
               const prompt = `Hãy phân tích địa điểm "${searchTerm}" tại vị trí (${lat}, ${lng}).
      Chỉ trả về theo định dạng JSON sau, không thêm text nào khác:
      {
          "name": "${location.display_name.split(',')[0]}",
          "lat": ${lat},
          "lng": ${lng},
          "sectors": [
              {
                  "name": "tên ngành",
                  "percentage": số_phần_trăm,
                  "description": "mô tả ngắn về đặc điểm và vai trò của ngành này tại khu vực"
              }
          ],
          "analysis": {
              "strengths": "điểm mạnh của khu vực",
              "weaknesses": "điểm yếu cần cải thiện",
              "challenges": "khó khăn cần giải quyết", 
              "requirements": "kiến thức và kỹ năng cần có"
          }
      }
          Lưu ý:
              - Phân tích và chọn tối đa 5 ngành thực sự nổi bật, quan trọng nhất của khu vực
              - Tỷ lệ phần trăm phản ánh mức độ đóng góp/quan trọng của ngành đó với địa phương
              - Tên ngành phải cụ thể, thể hiện được đặc trưng của khu vực`;
               const response = await fetch(`${config.GEMINI_API_URL}?key=${config.GEMINI_API_KEY}`, {
                    method: 'POST',
                    headers: {
                         'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                         contents: [
                              {
                                   parts: [
                                        {
                                             text: prompt,
                                        },
                                   ],
                              },
                         ],
                         generationConfig: {
                              temperature: 0.1,
                              topP: 1,
                              topK: 1,
                         },
                    }),
               });
               const data = await response.json();

               if (!data.candidates || !data.candidates[0]?.content?.parts[0]?.text) {
                    throw new Error('Không nhận được dữ liệu phân tích từ API');
               }

               let jsonText = data.candidates[0].content.parts[0].text;
               jsonText = cleanJsonText(jsonText);

               let locationData = JSON.parse(jsonText);

               validateLocationData(locationData);

               // Đảm bảo giữ nguyên tọa độ từ Nominatim
               locationData.lat = lat;
               locationData.lng = lng;
               const marker = createLocationMarker(locationData);
               saveSearchPoint(locationData);
               updateMapView(locationData);
               marker.openPopup();
          } catch (error: any) {
               console.error('Search Error:', error);
               alert('Có lỗi xảy ra khi tìm kiếm địa điểm: ' + error.message);
          } finally {
               loadingSpan.style.display = 'none';
          }
     }

     async function showBusinessAnalysis(locationName: string, isVietnam: boolean) {
          console.log('locationName', locationName, 'isVietnam', isVietnam);
          const locationData = isVietnam ? provinceData[locationName] : usData[locationName];
          if (!locationData) return;

          try {
               // Hiển thị loading
               const loadingPopup = L.popup()
                    .setLatLng(locationData.coordinates)
                    .setContent(
                         '<div style="text-align: center; padding: 20px;">Đang phân tích ý tưởng kinh doanh...</div>',
                    )
                    .openOn(map);

               const analysis = await analyzeBusinessIdea(
                    { ...locationData, name: locationName },
                    isVietnam ? 'VN' : 'US',
               );
               // Lưu ý tưởng mới
               const ideaId = saveBusinessIdea(
                    {
                         name: locationName,
                         lat: locationData.coordinates[0],
                         lng: locationData.coordinates[1],
                         type: isVietnam ? 'tỉnh' : 'bang',
                    },
                    analysis,
               );

               // Kiểm tra xem có ý tưởng trước đó không
               const previousIdeas = getBusinessIdeasHistory().filter(
                    (item: any) =>
                         item.location.name === locationName &&
                         Math.abs(item.location.lat - locationData.coordinates[0]) < 0.0001 &&
                         Math.abs(item.location.lng - locationData.coordinates[1]) < 0.0001,
               );

               // Tạo nội dung popup phân tích
               const popupContent = `
  <div class="business-analysis-popup">
      <h4>${analysis.businessIdea.name}</h4>
      
      <div class="business-section">
          <div class="business-section-title">Mô tả</div>
          <p>${analysis.businessIdea.description}</p>
      </div>

      <div class="business-section">
          <div class="business-section-title">Mô hình kinh doanh</div>
          <p><strong>Tổng quan:</strong> ${analysis.businessIdea.businessModel.overview}</p>
          <p><strong>Khách hàng mục tiêu:</strong> ${analysis.businessIdea.businessModel.targetCustomer}</p>
          <p><strong>Giá trị mang lại:</strong> ${analysis.businessIdea.businessModel.valueProposition}</p>
          <p><strong>Nguồn thu:</strong> ${analysis.businessIdea.businessModel.revenueStreams}</p>
      </div>

      <div class="business-section">
          <div class="business-section-title">Thách thức và Giải pháp</div>
          ${analysis.businessIdea.challenges
               .map(
                    (item: any) => `
              <div class="challenge-item">
                  <p><strong>Thách thức:</strong> ${item.challenge}</p>
                  <p><strong>Giải pháp:</strong> ${item.solution}</p>
              </div>
          `,
               )
               .join('')}
      </div>

      <div class="business-section">
          <div class="business-section-title">Các bước triển khai</div>
          ${analysis.businessIdea.implementationSteps
               .map(
                    (step: string, index: number) => `
              <div class="implementation-step">
                  <div class="step-number">${index + 1}</div>
                  <div>${step}</div>
              </div>
          `,
               )
               .join('')}
      </div>

      <div style="margin-top: 15px; display: flex; gap: 10px; justify-content: center;">
          <button id="show-business-history-btn"  
                  class="analyze-business-btn" style="background-color: #2196F3;width: 50%;">
              <svg fill="#000000" width="16px" height="16px" viewBox="-1 0 19 19" xmlns="http://www.w3.org/2000/svg" class="cf-icon-svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"><path d="M16.417 9.583A7.917 7.917 0 1 1 8.5 1.666a7.917 7.917 0 0 1 7.917 7.917zm-2.787.06a5.076 5.076 0 0 0-7.6-4.401 5.11 5.11 0 0 0-1.252 1.015V5.57a.396.396 0 0 0-.792 0v1.66a.396.396 0 0 0 .396.395H6.04a.396.396 0 0 0 0-.791h-.717A4.274 4.274 0 0 1 8.556 5.36a4.282 4.282 0 1 1-4.283 4.283.396.396 0 0 0-.792 0 5.074 5.074 0 1 0 10.15 0zm-4.763-.099V6.872a.396.396 0 0 0-.791 0v2.841a.395.395 0 0 0 .153.313l1.537 1.536a.396.396 0 1 0 .56-.56z"></path></g></svg>
              Xem lịch sử ý tưởng
          </button>
          <button id="show-business-btn" class="analyze-business-btn" style="background-color: #4CAF50;width: 50%;">
              <svg width="16px" height="16px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path fill-rule="evenodd" clip-rule="evenodd" d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22ZM12.75 9C12.75 8.58579 12.4142 8.25 12 8.25C11.5858 8.25 11.25 8.58579 11.25 9L11.25 11.25H9C8.58579 11.25 8.25 11.5858 8.25 12C8.25 12.4142 8.58579 12.75 9 12.75H11.25V15C11.25 15.4142 11.5858 15.75 12 15.75C12.4142 15.75 12.75 15.4142 12.75 15L12.75 12.75H15C15.4142 12.75 15.75 12.4142 15.75 12C15.75 11.5858 15.4142 11.25 15 11.25H12.75V9Z" fill="#1C274C"></path> </g></svg>
              Tạo ý tưởng mới
          </button>
      </div>
  </div>
`;
               setTimeout(() => {
                    const showBusinessHistoryBtn = document.getElementById('show-business-history-btn');
                    if (showBusinessHistoryBtn) {
                         showBusinessHistoryBtn.addEventListener('click', () => {
                              console.log('002');
                              showBusinessHistory(locationData.coordinates[0], locationData.coordinates[1]);
                         });
                    }
                    const showBusinessBtn = document.getElementById('show-business-btn');
                    if (showBusinessBtn) {
                         showBusinessBtn.addEventListener('click', () => {
                              showBusinessAnalysis(locationName, isVietnam);
                         });
                    }
               }, 0);

               // Đóng loading popup và hiển thị kết quả
               map.closePopup(loadingPopup);
               L.popup().setLatLng(locationData.coordinates).setContent(popupContent).openOn(map);
          } catch (error: any) {
               console.error(error);
               map.closePopup();
               alert('Có lỗi xảy ra khi phân tích ý tưởng kinh doanh: ' + error.message);
          }
     }

     function initializeControls() {
          const historyPanel = document.getElementById('history-panel') as HTMLElement;
          const toggleHistoryBtn = document.getElementById('toggleHistory') as HTMLButtonElement;
          const toggleAnalysisBtn = document.getElementById('toggleAnalysis') as HTMLButtonElement;
          const countriesPanel = document.getElementById('countries-panel') as HTMLElement;
          const toggleCountriesBtn = document.getElementById('toggleCountries') as HTMLButtonElement;
          const closeHistoryBtn = document.getElementById('closeHistoryPanel') as HTMLButtonElement;
          const closeCountriesBtn = document.getElementById('closeCountriesPanel') as HTMLButtonElement;
          const backToInitialBtn = document.getElementById('backToInitialView') as HTMLButtonElement;

          // Initialize event listeners
          toggleHistoryBtn.addEventListener('click', function () {
               historyPanel.classList.toggle('visible');
               this.classList.toggle('active');
               countriesPanel.classList.remove('visible');
               toggleCountriesBtn.classList.remove('active');
          });

          toggleCountriesBtn.addEventListener('click', function () {
               if (!this.disabled) {
                    countriesPanel.classList.toggle('visible');
                    this.classList.toggle('active');
                    historyPanel.classList.remove('visible');
                    toggleHistoryBtn.classList.remove('active');
               }
          });

          closeHistoryBtn.addEventListener('click', function () {
               historyPanel.classList.remove('visible');
               toggleHistoryBtn.classList.remove('active');
          });

          closeCountriesBtn.addEventListener('click', function () {
               countriesPanel.classList.remove('visible');
               toggleCountriesBtn.classList.remove('active');
          });

          toggleAnalysisBtn.addEventListener('click', function () {
               AreaAnalysis.toggleAnalysisMode();
               this.classList.toggle('active');
          });
          const searchInput = document.getElementById('searchInput') as HTMLInputElement;
          searchInput.addEventListener('keypress', function (e) {
               if (e.key === 'Enter') {
                    searchLocation();
               }
          });

          backToInitialBtn.addEventListener('click', function () {
               if (searchMarker) {
                    map.removeLayer(searchMarker);
                    searchMarker = null;
               }
               markers.forEach((marker) => {
                    map.removeLayer(marker);
               });
               markers.clear();

               map.setView([16.047079, 108.20623], 6);
               this.style.display = 'none';

               historyPanel.classList.remove('visible');
               countriesPanel.classList.remove('visible');
               toggleHistoryBtn.classList.remove('active');
               toggleCountriesBtn.classList.remove('active');
               searchInput.value = '';
          });

          map.on('moveend', function () {
               if (map.getZoom() !== 12 || map.getCenter().lat !== 16.047079 || map.getCenter().lng !== 108.20623) {
                    backToInitialBtn.style.display = 'flex';
               } else {
                    backToInitialBtn.style.display = 'none';
               }
          });

          addPinControl();
     }

     async function analyzeSearchBusinessIdea(locationData: any) {
          const prompt = `Hãy đề xuất một ý tưởng kinh doanh phù hợp cho khu vực ${locationData.name} dựa trên các thông tin sau:
Ngành nghề đừng đầu ở hiện tại và tương lai của khu vực đó
Thông tin về khu vực:
- Vị trí: ${locationData.lat}, ${locationData.lng}
- Điểm mạnh: ${locationData.analysis.strengths}
- Điểm yếu: ${locationData.analysis.weaknesses}
- Thách thức: ${locationData.analysis.challenges}

Hãy phân tích và trả về kết quả theo định dạng JSON sau:
{
"businessIdea": {
  "name": "Tên ý tưởng kinh doanh",
  "description": "Mô tả ngắn gọn về ý tưởng",
  "businessModel": {
      "overview": "Tổng quan về mô hình kinh doanh",
      "targetCustomer": "Đối tượng khách hàng mục tiêu",
      "valueProposition": "Giá trị mang lại cho khách hàng",
      "revenueStreams": "Các nguồn thu chính"
  },
  "challenges": [
      {
          "challenge": "Mô tả thách thức",
          "solution": "Giải pháp đề xuất"
      }
  ],
  "implementationSteps": [
      "Các bước triển khai chính"
  ]
}
}`;
          try {
               const response = await fetch(`${config.GEMINI_API_URL}?key=${config.GEMINI_API_KEY}`, {
                    method: 'POST',
                    headers: {
                         'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                         contents: [
                              {
                                   parts: [
                                        {
                                             text: prompt,
                                        },
                                   ],
                              },
                         ],
                         generationConfig: {
                              temperature: 0.7,
                              topK: 40,
                              topP: 0.95,
                              maxOutputTokens: 1024,
                         },
                    }),
               });

               if (!response.ok) {
                    throw new Error('Không thể kết nối đến API');
               }

               const result = await response.json();
               if (!result.candidates || !result.candidates[0]?.content?.parts[0]?.text) {
                    throw new Error('Không nhận được phản hồi hợp lệ');
               }
               const jsonText = result.candidates[0].content.parts[0].text;
               const cleanJson = cleanJsonText(jsonText);
               return JSON.parse(cleanJson);
          } catch (error) {
               console.error('Business Analysis Error:', error);
               throw new Error('Không thể phân tích ý tưởng kinh doanh');
          }
     }

     // Validate dữ liệu địa điểm
     function validateLocationData(locationData: any) {
          if (!locationData || typeof locationData !== 'object') {
               throw new Error('Dữ liệu địa điểm không hợp lệ');
          }

          if (!locationData.lat || !locationData.lng) {
               throw new Error('Thiếu thông tin tọa độ địa điểm');
          }

          if (!locationData.name) {
               throw new Error('Thiếu tên địa điểm');
          }

          // Đảm bảo sectors là một mảng
          if (!Array.isArray(locationData.sectors)) {
               locationData.sectors = [];
          }

          // Đảm bảo analysis tồn tại và có đầy đủ trường
          locationData.analysis = {
               strengths: locationData.analysis?.strengths || '',
               weaknesses: locationData.analysis?.weaknesses || '',
               challenges: locationData.analysis?.challenges || '',
               requirements: locationData.analysis?.requirements || '',
          };

          return locationData;
     }

     // Validate kết quả phân tích
     function validateAnalysisResult(analysis: any) {
          if (!analysis || !analysis.businessIdea) {
               throw new Error('Kết quả phân tích không hợp lệ');
          }

          // Đảm bảo các trường cần thiết tồn tại
          analysis.businessIdea = {
               name: analysis.businessIdea.name || 'Chưa có tên',
               description: analysis.businessIdea.description || 'Chưa có mô tả',
               businessModel: {
                    overview: analysis.businessIdea.businessModel?.overview || '',
                    targetCustomer: analysis.businessIdea.businessModel?.targetCustomer || '',
                    valueProposition: analysis.businessIdea.businessModel?.valueProposition || '',
                    revenueStreams: analysis.businessIdea.businessModel?.revenueStreams || '',
               },
               challenges: Array.isArray(analysis.businessIdea.challenges) ? analysis.businessIdea.challenges : [],
               implementationSteps: Array.isArray(analysis.businessIdea.implementationSteps)
                    ? analysis.businessIdea.implementationSteps
                    : [],
          };

          return analysis;
     }

     async function showSearchBusinessAnalysis(locationData: any) {
          try {
               // Validate input data
               if (!locationData || !locationData.lat || !locationData.lng || !locationData.name) {
                    throw new Error('Thông tin địa điểm không hợp lệ hoặc thiếu dữ liệu');
               }

               // Ensure we have sectors array and analysis object
               locationData.sectors = Array.isArray(locationData.sectors) ? locationData.sectors : [];
               locationData.analysis = locationData.analysis || {};
               locationData.analysis = {
                    strengths: locationData.analysis.strengths || '',
                    weaknesses: locationData.analysis.weaknesses || '',
                    challenges: locationData.analysis.challenges || '',
                    requirements: locationData.analysis.requirements || '',
               };
               // Save to window.tempLocationData for future reference
               window.tempLocationData = { ...locationData };

               // Show loading popup
               const loadingPopup = L.popup()
                    .setLatLng([locationData.lat, locationData.lng])
                    .setContent(
                         '<div style="text-align: center; padding: 20px;">Đang phân tích ý tưởng kinh doanh...</div>',
                    )
                    .openOn(map);
               try {
                    // Get previous ideas for this location
                    const previousIdeas = getBusinessIdeasHistory().filter(
                         (item: any) =>
                              item.location &&
                              item.location.lat === locationData.lat &&
                              item.location.lng === locationData.lng,
                    );

                    // Create prompt and get analysis
                    const prompt = createBusinessPrompt(locationData, previousIdeas);
                    const analysis = await analyzeSearchBusinessIdea(locationData);

                    // Validate analysis result
                    if (!analysis || !analysis.businessIdea) {
                         throw new Error('Kết quả phân tích không hợp lệ');
                    }

                    // Save the new idea
                    const ideaId = saveBusinessIdea(locationData, analysis);
                    // Create popup content
                    const popupContent = `
      <div class="business-analysis-popup">
          <h4>${analysis.businessIdea.name || 'Chưa có tên'}</h4>
          
          <div class="business-section">
              <div class="business-section-title">Mô tả</div>
              <p>${analysis.businessIdea.description || 'Chưa có mô tả'}</p>
          </div>

          <div class="business-section">
              <div class="business-section-title">Mô hình kinh doanh</div>
              <p><strong>Tổng quan:</strong> ${analysis.businessIdea.businessModel?.overview || ''}</p>
              <p><strong>Khách hàng mục tiêu:</strong> ${analysis.businessIdea.businessModel?.targetCustomer || ''}</p>
              <p><strong>Giá trị mang lại:</strong> ${analysis.businessIdea.businessModel?.valueProposition || ''}</p>
              <p><strong>Nguồn thu:</strong> ${analysis.businessIdea.businessModel?.revenueStreams || ''}</p>
          </div>

          <div class="business-section">
              <div class="business-section-title">Thách thức và Giải pháp</div>
              ${(analysis.businessIdea.challenges || [])
                   .map(
                        (item: any) => `
                  <div class="challenge-item">
                      <p><strong>Thách thức:</strong> ${item.challenge || ''}</p>
                      <p><strong>Giải pháp:</strong> ${item.solution || ''}</p>
                  </div>
              `,
                   )
                   .join('')}
          </div>

          <div class="business-section">
              <div class="business-section-title">Các bước triển khai</div>
              ${(analysis.businessIdea.implementationSteps || [])
                   .map(
                        (step: string, index: number) => `
                  <div class="implementation-step">
                      <div class="step-number">${index + 1}</div>
                      <div>${step || ''}</div>
                  </div>
              `,
                   )
                   .join('')}
          </div>

          <div style="margin-top: 15px; display: flex; gap: 10px; justify-content: center;">
              <button id="show-history-btn" class="analyze-business-btn" style="background-color: #2196F3;">
                  <svg width="16px" height="16px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <g clip-path="url(#clip0_429_11075)"> <path d="M5.63606 18.3639C9.15077 21.8786 14.8493 21.8786 18.364 18.3639C21.8787 14.8492 21.8787 9.1507 18.364 5.63598C14.8493 2.12126 9.15077 2.12126 5.63606 5.63598C3.87757 7.39447 2.99889 9.6996 3.00002 12.0044L3 13.9999" stroke="#292929" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path> <path d="M1 11.9999L3 13.9999L5 11.9999" stroke="#292929" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path> <path d="M11 7.99994L11 12.9999L16 12.9999" stroke="#292929" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path> </g> <defs> <clipPath id="clip0_429_11075"> <rect width="24" height="24" fill="white"></rect> </clipPath> </defs> </g></svg>
                  Xem lịch sử ý tưởng
              </button>
              <button id="handle-search-business-btn" class="analyze-business-btn">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6">
  <path fill-rule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM12.75 9a.75.75 0 0 0-1.5 0v2.25H9a.75.75 0 0 0 0 1.5h2.25V15a.75.75 0 0 0 1.5 0v-2.25H15a.75.75 0 0 0 0-1.5h-2.25V9Z" clip-rule="evenodd" />
</svg>

                  Tạo ý tưởng mới
              </button>
          </div>
      </div>
  `;
                    setTimeout(() => {
                         const showHistoryBtn = document.getElementById('show-history-btn') as HTMLButtonElement;
                         if (showHistoryBtn) {
                              showHistoryBtn.addEventListener('click', () => {
                                   console.log('001');
                                   showBusinessHistory(locationData.lat, locationData.lng);
                              });
                         }
                         // const handleSearchBusinessAnalysisBtn = document.getElementById(
                         //      'handle-search-business-btn',
                         // ) as HTMLButtonElement;
                         // if (handleSearchBusinessAnalysisBtn) {
                         //      handleSearchBusinessAnalysisBtn.addEventListener('click', () =>
                         //           handleSearchBusinessAnalysis(),
                         //      );
                         // }
                    }, 0);

                    // Close loading popup and show result
                    map.closePopup(loadingPopup);
                    L.popup().setLatLng([locationData.lat, locationData.lng]).setContent(popupContent).openOn(map);
               } catch (error) {
                    // Close loading popup if there's an error
                    map.closePopup(loadingPopup);
                    throw error; // Re-throw to be caught by outer try-catch
               }
          } catch (error: any) {
               console.error('Business Analysis Error:', error);
               map.closePopup(); // Ensure any open popup is closed
               alert('Có lỗi xảy ra khi phân tích ý tưởng kinh doanh: ' + error.message);
          }
     }

     function showBusinessHistory(lat: number, lng: number) {
          console.log('lat', lat, 'lng', lng);
          console.log('MARKES 1', markers);
          markers.clear();
          console.log('MARKES 2', markers);
          const ideas = getBusinessIdeasHistory().filter(
               (item: any) => item.location.lat === lat && item.location.lng === lng,
          );

          if (ideas.length === 0) {
               alert('Chưa có ý tưởng nào được tạo cho địa điểm này.');
               return;
          }
          const popupContent = `
<div class="business-analysis-popup">
  <h4>Lịch sử ý tưởng kinh doanh</h4>
  ${ideas
       .map(
            (item: any, index: number) => `
      <div class="business-section" style="margin-bottom: 15px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
              <div class="business-section-title">
                  #${index + 1} - ${item.idea.businessIdea.name}
              </div>
              <div style="color: #666; font-size: 12px;">
                  ${new Date(item.timestamp).toLocaleString()}
              </div>
          </div>
          <p style="margin: 10px 0;">${item.idea.businessIdea.description}</p>
          <button class="analyze-business-btn show-full-idea-btn" data-idea-id="${item.id}"
                  style="margin-top: 10px; width: 100%;">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6">
  <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
  <path fill-rule="evenodd" d="M1.323 11.447C2.811 6.976 7.028 3.75 12.001 3.75c4.97 0 9.185 3.223 10.675 7.69.12.362.12.752 0 1.113-1.487 4.471-5.705 7.697-10.677 7.697-4.97 0-9.186-3.223-10.675-7.69a1.762 1.762 0 0 1 0-1.113ZM17.25 12a5.25 5.25 0 1 1-10.5 0 5.25 5.25 0 0 1 10.5 0Z" clip-rule="evenodd" />
</svg>

              Xem chi tiết
          </button>
      </div>
  `,
       )
       .join('')}
</div>
`;
          setTimeout(() => {
               const showFullIdeaBtns = document.querySelectorAll('.show-full-idea-btn');
               if (showFullIdeaBtns) {
                    showFullIdeaBtns.forEach((button) => {
                         button.addEventListener('click', (event) => {
                              const ideaId = (event.target as HTMLElement).getAttribute('data-idea-id');
                              if (ideaId) {
                                   showFullBusinessIdea(ideaId);
                              }
                         });
                    });
               }
          }, 0);

          L.popup().setLatLng([lat, lng]).setContent(popupContent).openOn(map);
     }

     function showFullBusinessIdea(ideaId: string) {
          const history = getBusinessIdeasHistory();
          const idea = history.find((item: any) => item.id.toString() === ideaId);

          if (!idea) {
               alert('Không tìm thấy ý tưởng này.');
               return;
          }

          const analysis = idea.idea;
          const popupContent = `
<div class="business-analysis-popup">
  <h4>${analysis.businessIdea.name}</h4>
  
  <div class="business-section">
      <div class="business-section-title">Mô tả</div>
      <p>${analysis.businessIdea.description}</p>
  </div>

  <div class="business-section">
      <div class="business-section-title">Mô hình kinh doanh</div>
      <p><strong>Tổng quan:</strong> ${analysis.businessIdea.businessModel.overview}</p>
      <p><strong>Khách hàng mục tiêu:</strong> ${analysis.businessIdea.businessModel.targetCustomer}</p>
      <p><strong>Giá trị mang lại:</strong> ${analysis.businessIdea.businessModel.valueProposition}</p>
      <p><strong>Nguồn thu:</strong> ${analysis.businessIdea.businessModel.revenueStreams}</p>
  </div>

  <div class="business-section">
      <div class="business-section-title">Thách thức và Giải pháp</div>
      ${analysis.businessIdea.challenges
           .map(
                (item: any) => `
          <div class="challenge-item">
              <p><strong>Thách thức:</strong> ${item.challenge}</p>
              <p><strong>Giải pháp:</strong> ${item.solution}</p>
          </div>
      `,
           )
           .join('')}
  </div>

  <div class="business-section">
      <div class="business-section-title">Các bước triển khai</div>
      ${analysis.businessIdea.implementationSteps
           .map(
                (step: string, index: number) => `
          <div class="implementation-step">
              <div class="step-number">${index + 1}</div>
              <div>${step}</div>
          </div>
      `,
           )
           .join('')}
  </div>

  <div style="margin-top: 15px; display: flex; gap: 10px; justify-content: center;">
      <button id="show-history-btn" class="analyze-business-btn" style="background-color: #2196F3;">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6">
  <path fill-rule="evenodd" d="M11.03 3.97a.75.75 0 0 1 0 1.06l-6.22 6.22H21a.75.75 0 0 1 0 1.5H4.81l6.22 6.22a.75.75 0 1 1-1.06 1.06l-7.5-7.5a.75.75 0 0 1 0-1.06l7.5-7.5a.75.75 0 0 1 1.06 0Z" clip-rule="evenodd" />
</svg>

          Quay lại lịch sử
      </button>
      <button id="delete-idea-btn" class="analyze-business-btn" style="background-color: #f44336;">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6">
  <path fill-rule="evenodd" d="M16.5 4.478v.227a48.816 48.816 0 0 1 3.878.512.75.75 0 1 1-.256 1.478l-.209-.035-1.005 13.07a3 3 0 0 1-2.991 2.77H8.084a3 3 0 0 1-2.991-2.77L4.087 6.66l-.209.035a.75.75 0 0 1-.256-1.478A48.567 48.567 0 0 1 7.5 4.705v-.227c0-1.564 1.213-2.9 2.816-2.951a52.662 52.662 0 0 1 3.369 0c1.603.051 2.815 1.387 2.815 2.951Zm-6.136-1.452a51.196 51.196 0 0 1 3.273 0C14.39 3.05 15 3.684 15 4.478v.113a49.488 49.488 0 0 0-6 0v-.113c0-.794.609-1.428 1.364-1.452Zm-.355 5.945a.75.75 0 1 0-1.5.058l.347 9a.75.75 0 1 0 1.499-.058l-.346-9Zm5.48.058a.75.75 0 1 0-1.498-.058l-.347 9a.75.75 0 0 0 1.5.058l.345-9Z" clip-rule="evenodd" />
</svg>

          Xóa ý tưởng
      </button>
  </div>
</div>
`;
          setTimeout(() => {
               const showHistoryBtn = document.getElementById('show-history-btn') as HTMLButtonElement;
               if (showHistoryBtn) {
                    showHistoryBtn.addEventListener('click', () =>
                         showBusinessHistory(idea.location.lat, idea.location.lng),
                    );
               }
               const deleteIdeaBtn = document.getElementById('delete-idea-btn') as HTMLButtonElement;
               if (deleteIdeaBtn) {
                    deleteIdeaBtn.addEventListener('click', () => {
                         deleteBusinessIdea(ideaId);
                         showBusinessHistory(idea.location.lat, idea.location.lng);
                    });
               }
          }, 0);

          L.popup().setLatLng([idea.location.lat, idea.location.lng]).setContent(popupContent).openOn(map);
     }

     function initializeCountriesPanel() {
          const backButton = document.getElementById('backButton') as HTMLButtonElement;
          const countriesList = document.getElementById('countriesList') as HTMLElement;
          const titleList = document.getElementById('title-list') as HTMLElement;

          backButton.addEventListener('click', showCountriesList);
          showCountriesList();

          function showCountriesList() {
               const searchContainer = document.querySelector('.search-in-countries') as HTMLElement;
               searchContainer.classList.remove('hidden');
               backButton.classList.remove('visible');
               countriesList.innerHTML = '';
               titleList.innerText = 'Danh sách quốc gia';
               const flags: {
                    VN: string;
                    US: string;
               } = {
                    VN: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/21/Flag_of_Vietnam.svg/1200px-Flag_of_Vietnam.svg.png',
                    US: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Flag_of_the_United_States.svg/1200px-Flag_of_the_United_States.svg.png',
               };

               countries.forEach((country) => {
                    const countryDiv = document.createElement('div');
                    countryDiv.className = 'country-item';

                    countryDiv.innerHTML = `
              <span class="country-name">${country.name}</span>
              <img src="${flags[country.code]}" 
                  alt="${country.name}" 
                  class="country-flag">
          `;

                    countryDiv.addEventListener('click', function () {
                         if (country.code === 'VN') {
                              showProvincesList(country.code);
                              titleList.innerText = 'Danh sách các tỉnh';
                         } else {
                              showStatesList();
                         }
                    });

                    countriesList.appendChild(countryDiv);
               });
          }

          function showStatesList() {
               const countriesList = document.getElementById('countriesList') as HTMLElement;
               const backButton = document.getElementById('backButton') as HTMLButtonElement;
               const searchContainer = document.querySelector('.search-in-countries') as HTMLElement;
               const titleList = document.getElementById('title-list') as HTMLElement;

               searchContainer.classList.add('hidden');

               if (Object.keys(usData).length === 0) {
                    countriesList.innerHTML = `
                  <div style="padding: 20px; text-align: center; color: #666;">
                      Không có dữ liệu cho Mỹ.<br>
                      Vui lòng kiểm tra file US.csv.
                  </div>
              `;
                    return;
               }

               backButton.classList.add('visible');
               countriesList.innerHTML = '';
               titleList.innerText = 'Danh sách các bang';

               // Sắp xếp các bang theo dân số (giảm dần)
               const sortedStates = Object.entries(usData)
                    .sort((a, b) => b[1].population - a[1].population)
                    .map((entry) => entry[0]);

               sortedStates.forEach((location, index) => {
                    const locationDiv = document.createElement('div');
                    locationDiv.className = 'province-item';

                    const locationData = usData[location];
                    let medal = '';
                    if (index === 0) medal = '🥇';
                    else if (index === 1) medal = '🥈';
                    else if (index === 2) medal = '🥉';

                    const stateContent = `
                  <div class="province-header" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0;">
                      <div style="flex: 1; color: #666;">${index + 1}. ${location} ${medal}</div>
                      <button class="toggle-districts" style="background: none; border: none; color: #2196F3; cursor: pointer;">
                         <svg width="20px" height="20px" viewBox="0 0 1024 1024" fill="#344CB7" class="icon" version="1.1" xmlns="http://www.w3.org/2000/svg" stroke="#000000" stroke-width="51.2"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"><path d="M478.312 644.16c24.38 26.901 64.507 26.538 88.507-0.89l270.57-309.222c7.758-8.867 6.86-22.344-2.008-30.103-8.866-7.759-22.344-6.86-30.103 2.007L534.71 615.173c-7.202 8.231-17.541 8.325-24.782 0.335L229.14 305.674c-7.912-8.73-21.403-9.394-30.133-1.482s-9.394 21.403-1.482 30.134l280.786 309.833z" fill=""></path></g></svg>
                      </button>
                  </div>
                  <div class="province-details" style="display: none; padding: 10px; background: #f8f9fa; border-radius: 8px; margin-top: 10px; color:#666;">
                      <div style="margin-bottom: 10px;">
                          <p><strong>Population:</strong> ${locationData.population?.toLocaleString()} people</p>
                          <p><strong>Area:</strong> ${locationData.area?.toLocaleString()} sq km</p>
                          <p><strong>Population Density:</strong> ${locationData.density?.toLocaleString()} people/sq km</p>
                          <p><strong>Average Income:</strong> $${locationData.income?.toLocaleString()}/year</p>
                      </div>
                      ${
                           locationData.sectors && locationData.sectors.length > 0
                                ? `
                          <div style="margin-bottom: 10px;">
                              <p><strong>Main Industries:</strong></p>
                              <ul style="list-style-type: disc; margin-left: 20px; margin-bottom: 5px;">
                                  ${locationData.sectors.map((sector: string) => `<li>${sector}</li>`).join('')}
                              </ul>
                          </div>
                      `
                                : ''
                      }
                      ${
                           locationData.trends && locationData.trends.length > 0
                                ? `
                          <div style="margin-bottom: 10px;">
                              <p><strong>Development Trends:</strong></p>
                              <ul style="list-style-type: disc; margin-left: 20px; margin-bottom: 5px;">
                                  ${locationData.trends.map((trend: string) => `<li>${trend}</li>`).join('')}
                              </ul>
                          </div>
                      `
                                : ''
                      }
                      ${
                           locationData.opportunities
                                ? `
                          <div style="margin-bottom: 10px;">
                              <p><strong>Key Opportunities:</strong> ${locationData.opportunities}</p>
                          </div>
                      `
                                : ''
                      }
                      ${
                           locationData.challenges
                                ? `
                          <div style="margin-bottom: 10px;">
                              <p><strong>Key Challenges:</strong> ${locationData.challenges}</p>
                          </div>
                      `
                                : ''
                      }
                  </div>
              `;

                    locationDiv.innerHTML = stateContent;

                    // Xử lý sự kiện toggle
                    const toggleButton = locationDiv.querySelector('.toggle-districts');
                    const locationDetails = locationDiv.querySelector('.province-details') as HTMLElement;

                    if (toggleButton) {
                         toggleButton.addEventListener('click', (e) => {
                              e.stopPropagation();
                              const icon = toggleButton.querySelector('.icon-dropdown') as HTMLElement;
                              const isExpanded = locationDetails.style.display !== 'none';

                              locationDetails.style.display = isExpanded ? 'none' : 'block';
                              if (icon) {
                                   icon.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(180deg)';
                              }
                         });
                    }

                    // Xử lý sự kiện click cho header
                    const provinceHeader = locationDiv.querySelector('.province-header') as HTMLElement;
                    const countriesPanel = document.getElementById('countries-panel') as HTMLElement;
                    const toggleCountriesBtn = document.getElementById('toggleCountries') as HTMLButtonElement;
                    provinceHeader.addEventListener('click', function () {
                         zoomToLocation(location, 'US');
                         countriesPanel.classList.remove('visible');
                         toggleCountriesBtn.classList.remove('active');
                    });

                    countriesList.appendChild(locationDiv);
               });
          }

          function showProvincesList(countryCode: string) {
               const data = countryCode === 'VN' ? provinceData : usData;
               const searchContainer = document.querySelector('.search-in-countries') as HTMLElement;
               searchContainer.classList.add('hidden');

               if (Object.keys(data).length === 0) {
                    countriesList.innerHTML = `
      <div style="padding: 20px; text-align: center; color: #666;">
          Không có dữ liệu cho Việt Nam.<br>
          Vui lòng kiểm tra file CSV.
      </div>
  `;
                    return;
               }

               backButton.classList.add('visible');
               countriesList.innerHTML = '';

               // Danh sách có sẵn cho Việt Nam
               const orderedProvinces = [
                    'TP. Hồ Chí Minh',
                    'Hà Nội',
                    'Bình Dương',
                    'Đồng Nai',
                    'Bà Rịa – Vũng Tàu',
                    'Hải Phòng',
                    'Quảng Ninh',
                    'Bắc Ninh',
                    'Thanh Hóa',
                    'Nghệ An',
                    'Hải Dương',
                    'Long An',
                    'Bắc Giang',
                    'Vĩnh Phúc',
                    'Thái Nguyên',
                    'Hưng Yên',
                    'Đà Nẵng',
                    'Quảng Ngãi',
                    'Quảng Nam',
                    'Kiên Giang',
                    'Tiền Giang',
                    'Thái Bình',
                    'An Giang',
                    'Đắk Lắk',
                    'Cần Thơ',
                    'Bình Định',
                    'Gia Lai',
                    'Lâm Đồng',
                    'Tây Ninh',
                    'Đồng Tháp',
                    'Khánh Hòa',
                    'Bình Thuận',
                    'Hà Tĩnh',
                    'Nam Định',
                    'Phú Thọ',
                    'Bình Phước',
                    'Hà Nam',
                    'Ninh Bình',
                    'Cà Mau',
                    'Trà Vinh',
                    'Vĩnh Long',
                    'Lào Cai',
                    'Thừa Thiên Huế',
                    'Sóc Trăng',
                    'Sơn La',
                    'Bến Tre',
                    'Hòa Bình',
                    'Bạc Liêu',
                    'Phú Yên',
                    'Quảng Bình',
                    'Hậu Giang',
                    'Ninh Thuận',
                    'Tuyên Quang',
                    'Quảng Trị',
                    'Lạng Sơn',
                    'Yên Bái',
                    'Đắk Nông',
                    'Kon Tum',
                    'Hà Giang',
                    'Điện Biên',
                    'Lai Châu',
                    'Cao Bằng',
                    'Bắc Kạn',
               ];

               orderedProvinces.forEach((location, index) => {
                    if (data[location]) {
                         const locationDiv = document.createElement('div');
                         locationDiv.className = 'province-item';

                         let medal = '';
                         if (index === 0) medal = '🥇';
                         else if (index === 1) medal = '🥈';
                         else if (index === 2) medal = '🥉';

                         const grdpInfo = data[location].grdp ? `GRDP: ${data[location].grdp} tỉ USD` : '';

                         // Tạo nội dung cho tỉnh/thành phố
                         const provinceContent = `
          <div class="province-header" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0;">
              <div style="flex: 1; color: #666;">${index + 1}. ${location} ${medal}</div>
              <div style="color: #666; font-size: 0.9em; margin-left: 10px;">${grdpInfo}</div>
              <button class="toggle-districts" style="background: none; border: none; color: #2196F3; cursor: pointer;">
                         <svg width="20px" height="20px" viewBox="0 0 1024 1024" fill="#344CB7" class="icon" version="1.1" xmlns="http://www.w3.org/2000/svg" stroke="#000000" stroke-width="51.2"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"><path d="M478.312 644.16c24.38 26.901 64.507 26.538 88.507-0.89l270.57-309.222c7.758-8.867 6.86-22.344-2.008-30.103-8.866-7.759-22.344-6.86-30.103 2.007L534.71 615.173c-7.202 8.231-17.541 8.325-24.782 0.335L229.14 305.674c-7.912-8.73-21.403-9.394-30.133-1.482s-9.394 21.403-1.482 30.134l280.786 309.833z" fill=""></path></g></svg>
              </button>
          </div>
          <div class="province-details" style="display: none; padding: 10px; background: #f8f9fa; border-radius: 8px; margin-top: 10px; color: #666;">
              <div style="margin-bottom: 10px;">
                  <p><strong>Dân số:</strong> ${data[location].population?.toLocaleString()} người</p>
                  <p><strong>Diện tích:</strong> ${data[location].area?.toLocaleString()} km²</p>
                  <p><strong>Mật độ dân số:</strong> ${data[location].density?.toLocaleString()} người/km²</p>
                  <p><strong>Thu nhập bình quân:</strong> ${countryCode === 'VN' ? `${data[location].income} triệu đồng/tháng` : `$${data[location].income?.toLocaleString()}/year`}</p>
              </div>
              ${
                   data[location].sectors && data[location].sectors.length > 0
                        ? `
                  <div style="margin-bottom: 10px;">
                      <p><strong>Các ngành chính:</strong></p>
                      <ul style="list-style-type: disc; margin-left: 20px; margin-bottom: 5px;">
                          ${data[location].sectors.map((sector: string) => `<li>${sector}</li>`).join('')}
                      </ul>
                  </div>
              `
                        : ''
              }
              ${
                   data[location].trends && data[location].trends.length > 0
                        ? `
                  <div style="margin-bottom: 10px;">
                      <p><strong>Xu hướng phát triển:</strong></p>
                      <ul style="list-style-type: disc; margin-left: 20px; margin-bottom: 5px;">
                          ${data[location].trends.map((trend: string) => `<li>${trend}</li>`).join('')}
                      </ul>
                  </div>
              `
                        : ''
              }
          </div>
      `;

                         // Thêm nội dung quận/huyện nếu có
                         const districtsContent = districtsData[location]
                              ? `
          <div class="districts-list" style="display: none; margin-top: 10px; padding: 10px; background: #fff; border-radius: 8px;">
              <h4 style="margin-bottom: 10px; color: #2196F3;">Quận/Huyện thuộc ${location}</h4>
              ${districtsData[location]
                   .map(
                        (district: any) => `
                  <div class="district-item" style="padding: 8px; margin: 4px 0; background: #f8f9fa; border-radius: 4px; cursor: pointer;color: #666"
                       data-lat="${district.coordinates[0]}" 
                       data-lng="${district.coordinates[1]}">
                      <div style="font-weight: 500;">${district.name}</div>
                      <div style="font-size: 0.8em; color: #666;">
                          Vị trí: ${district.coordinates[0]?.toFixed(6)}, ${district.coordinates[1]?.toFixed(6)}
                      </div>
                  </div>
              `,
                   )
                   .join('')}
          </div>
      `
                              : '';

                         locationDiv.innerHTML = provinceContent + districtsContent;

                         // Xử lý sự kiện click cho toggle buttons
                         const toggleButton = locationDiv.querySelector('.toggle-districts') as HTMLButtonElement;
                         const provinceDetails = locationDiv.querySelector('.province-details') as HTMLElement;
                         const districtsList = locationDiv.querySelector('.districts-list') as HTMLElement;

                         if (toggleButton) {
                              toggleButton.addEventListener('click', (e) => {
                                   e.stopPropagation();
                                   const icon = toggleButton.querySelector('.icon-dropdown') as HTMLElement;
                                   const isExpanded = provinceDetails.style.display !== 'none';

                                   // Toggle province details
                                   provinceDetails.style.display = isExpanded ? 'none' : 'block';
                                   if (districtsList) {
                                        districtsList.style.display = isExpanded ? 'none' : 'block';
                                   }

                                   // Rotate icon
                                   if (icon) {
                                        icon.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(180deg)';
                                   }
                              });
                         }

                         // Xử lý sự kiện click cho từng quận/huyện
                         if (districtsList) {
                              locationDiv.querySelectorAll('.district-item').forEach((districtDiv) => {
                                   districtDiv.addEventListener('click', function (e) {
                                        e.stopPropagation();

                                        const target = e.currentTarget as HTMLElement;
                                        const lat = parseFloat(target.dataset.lat || '0');
                                        const lng = parseFloat(target.dataset.lng || '0');
                                        const districtName = target.querySelector('div')?.textContent || '';

                                        // Di chuyển bản đồ đến quận/huyện
                                        map.setView([lat, lng], 13);

                                        // Tạo marker với popup có nút phân tích
                                        if (markers.has(districtName)) {
                                             map.removeLayer(markers.get(districtName));
                                        }
                                        const marker = L.marker([lat, lng])
                                             .addTo(map)
                                             .bindPopup(
                                                  `
                                                  <div style="min-width: 200px;">
                                                       <h3 style="color: #2196F3; margin-bottom: 8px;">${districtName}</h3>
                                                       <p style="color: #666;">Thuộc ${location}</p>
                                                       <div style="margin-top: 8px;">
                                                       <p>Vĩ độ: ${lat.toFixed(6)}</p>
                                                       <p>Kinh độ: ${lng.toFixed(6)}</p>
                                                       </div>
                                                       <button id="show-district-btn"
                                                            style="
                                                                 margin-top: 10px;locationDiv.querySelector('.province-header').addEventListener('click', function () {
                                                                      zoomToLocation(location, 'US');
                                                                      document.getElementById('countries-panel').classList.remove('visible');
                                                                      document.getElementById('toggleCountries').classList.remove('active');
                                                                 });
                                                                 width: 100%;
                                                                 padding: 8px 12px;
                                                                 background: linear-gradient(135deg, #64B5F6 0%, #F48FB1 100%);
                                                                 border: none;
                                                                 border-radius: 4px;
                                                                 color: #333;
                                                                 cursor: pointer;
                                                                 display: flex;
                                                                 align-items: center;
                                                                 gap: 8px;
                                                                 justify-content: center;
                                                                 font-size: 14px;
                                                                 transition: all 0.3s ease;
                                                            ">
                                                       
                                                       //    <svg width="16px" height="16px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path d="M7 16H8M11.5 16H12.5M16 16H17M18.4 20H5.6C5.03995 20 4.75992 20 4.54601 19.891C4.35785 19.7951 4.20487 19.6422 4.10899 19.454C4 19.2401 4 18.9601 4 18.4V4.8C4 4.51997 4 4.37996 4.0545 4.273C4.10243 4.17892 4.17892 4.10243 4.273 4.0545C4.37996 4 4.51997 4 4.8 4H7.2C7.48003 4 7.62004 4 7.727 4.0545C7.82108 4.10243 7.89757 4.17892 7.9455 4.273C8 4.37996 8 4.51997 8 4.8V9.06863C8 9.67445 8 9.97735 8.1198 10.1176C8.22374 10.2393 8.37967 10.3039 8.53923 10.2914C8.72312 10.2769 8.93731 10.0627 9.36569 9.63431L12.6343 6.36569C13.0627 5.93731 13.2769 5.72312 13.4608 5.70865C13.6203 5.69609 13.7763 5.76068 13.8802 5.88238C14 6.02265 14 6.32556 14 6.93137V9.06863C14 9.67445 14 9.97735 14.1198 10.1176C14.2237 10.2393 14.3797 10.3039 14.5392 10.2914C14.7231 10.2769 14.9373 10.0627 15.3657 9.63431L18.6343 6.36569C19.0627 5.93731 19.2769 5.72312 19.4608 5.70865C19.6203 5.69609 19.7763 5.76068 19.8802 5.88238C20 6.02265 20 6.32556 20 6.93137V18.4C20 18.9601 20 19.2401 19.891 19.454C19.7951 19.6422 19.6422 19.7951 19.454 19.891C19.2401 20 18.9601 20 18.4 20Z" stroke="#000000" stroke-width="2" stroke-linecap="round"></path> </g></svg>
                                                            Phân tích khu vực
                                                       </button>
                                                  </div>
                                             `,
                                             )
                                             .openPopup();

                                        setTimeout(() => {
                                             const showDistrictBtn = document.getElementById(
                                                  'show-district-btn',
                                             ) as HTMLButtonElement;
                                             if (showDistrictBtn) {
                                                  showDistrictBtn.addEventListener('click', () => {
                                                       showDistrictAnalysis(districtName, location, lat, lng);
                                                  });
                                             }
                                        }, 0);
                                        markers.set(districtName, marker);
                                   });
                              });
                         }

                         // Thêm sự kiện click cho cả phần tỉnh
                         const provinceHeader = locationDiv.querySelector('.province-header') as HTMLElement;
                         const countriesPanel = document.getElementById('countries-panel') as HTMLElement;
                         const toggleCountriesBtn = document.getElementById('toggleCountries') as HTMLButtonElement;
                         provinceHeader.addEventListener('click', function () {
                              zoomToLocation(location, countryCode);
                              countriesPanel.classList.remove('visible');
                              toggleCountriesBtn.classList.remove('active');
                         });

                         countriesList.appendChild(locationDiv);
                    }
               });
          }

          backButton.addEventListener('click', showCountriesList);
          showCountriesList();
     }

     // Thêm vào phần khởi tạo ứng dụng
     document.addEventListener('DOMContentLoaded', async function () {
          try {
               // Load district data
               const districtResponse = await fetch('/quan_huyen.csv');
               const districtText = await districtResponse.text();
               districtsData = organizeDistrictsByProvince(districtText);

               // Initialize other components
               initializeMap();
               initializeControls();
               initializeCountriesPanel();
               updateHistoryPanel();
               loadProvinceData();
          } catch (error) {
               console.error('Error loading district data:', error);
          }
     });

     // function validateLocationData(locationData: any) {
     //      if (!locationData || !locationData.name || !locationData.lat || !locationData.lng) {
     //           throw new Error('Không tìm thấy thông tin địa điểm');
     //      }

     //      // Đảm bảo có mảng sectors
     //      if (!Array.isArray(locationData.sectors)) {
     //           locationData.sectors = [];
     //      }

     //      // Đảm bảo có object analysis
     //      locationData.analysis = locationData.analysis || {
     //           strengths: 'Chưa có thông tin',
     //           weaknesses: 'Chưa có thông tin',
     //           challenges: 'Chưa có thông tin',
     //           requirements: 'Chưa có thông tin',
     //      };
     // }

     function createLocationMarker(locationData: any) {
          if (searchMarker) {
               map.removeLayer(searchMarker);
          }
          const popupContent = createSearchResultPopup(locationData);
          searchMarker = L.marker([locationData.lat, locationData.lng], {
               title: locationData.name,
          })
               .bindPopup(popupContent as Content)
               .addTo(map);
          return searchMarker;
     }

     function createSearchResultPopup(locationData: any) {
          // Lưu locationData vào biến tạm thời
          if (!setTempLocationData(locationData)) {
               return '<div class="error-popup">Dữ liệu địa điểm không hợp lệ</div>';
          }

          // Kiểm tra xem có ý tưởng nào cho địa điểm này chưa
          const hasExistingIdeas = getBusinessIdeasHistory().some(
               (item: any) => item.location.lat === locationData.lat && item.location.lng === locationData.lng,
          );
          const popupContent = `
<div class="analysis-popup">
  <h4>${locationData.name}</h4>
  
  <div class="section-card">
      <div class="section-title">
          <svg width="16px" height="16px" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"><path clip-rule="evenodd" d="M1 20C1 18.8954 1.89543 18 3 18H6C7.10457 18 8 18.8954 8 20V25C8 26.1046 7.10457 27 6 27H3C1.89543 27 1 26.1046 1 25V20ZM6 20.4C6 20.1791 5.82091 20 5.6 20H3.4C3.17909 20 3 20.1791 3 20.4V24.6C3 24.8209 3.17909 25 3.4 25H5.6C5.82091 25 6 24.8209 6 24.6V20.4Z" fill="#000000" fill-rule="evenodd"></path><path clip-rule="evenodd" d="M10 3C10 1.89543 10.8954 1 12 1H15C16.1046 1 17 1.89543 17 3V25C17 26.1046 16.1046 27 15 27H12C10.8954 27 10 26.1046 10 25V3ZM15 3.4C15 3.17909 14.8209 3 14.6 3L12.4 3C12.1791 3 12 3.17909 12 3.4V24.6C12 24.8209 12.1791 25 12.4 25H14.6C14.8209 25 15 24.8209 15 24.6V3.4Z" fill="#000000" fill-rule="evenodd"></path><path clip-rule="evenodd" d="M19 11C19 9.89543 19.8954 9 21 9H24C25.1046 9 26 9.89543 26 11V25C26 26.1046 25.1046 27 24 27H21C19.8954 27 19 26.1046 19 25V11ZM24 11.4C24 11.1791 23.8209 11 23.6 11H21.4C21.1791 11 21 11.1791 21 11.4V24.6C21 24.8209 21.1791 25 21.4 25H23.6C23.8209 25 24 24.8209 24 24.6V11.4Z" fill="#000000" fill-rule="evenodd"></path></g></svg>
          <h5>Ngành chủ đạo</h5>
      </div>
      <div class="stat-container">
          ${locationData.sectors
               .map(
                    (sector: any) => `
              <div class="stat-item" title="${sector.description}">
                  <div class="stat-label">
                      ${sector.name}
                     <svg width="16px" height="16px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path fill-rule="evenodd" clip-rule="evenodd" d="M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12ZM12 17.75C12.4142 17.75 12.75 17.4142 12.75 17V11C12.75 10.5858 12.4142 10.25 12 10.25C11.5858 10.25 11.25 10.5858 11.25 11V17C11.25 17.4142 11.5858 17.75 12 17.75ZM12 7C12.5523 7 13 7.44772 13 8C13 8.55228 12.5523 9 12 9C11.4477 9 11 8.55228 11 8C11 7.44772 11.4477 7 12 7Z" fill="#1C274C"></path> </g></svg>

                  </div>
                  <div class="stat-bar">
                      <div class="stat-progress" style="width: ${sector.percentage}%"></div>
                  </div>
                  <div class="stat-value">${sector.percentage}%</div>
              </div>
          `,
               )
               .join('')}
      </div>
  </div>

  <div class="section-card">
      <div class="analysis-item">
          <h5 class="analysis-title">Điểm mạnh</h5>
          <p class="analysis-content">${locationData.analysis.strengths}</p>
      </div>
      <div class="analysis-item">
          <h5 class="analysis-title">Điểm yếu</h5>
          <p class="analysis-content">${locationData.analysis.weaknesses}</p>
      </div>
      <div class="analysis-item">
          <h5 class="analysis-title">Khó khăn</h5>
          <p class="analysis-content">${locationData.analysis.challenges}</p>
      </div>
      <div class="analysis-item">
          <h5 class="analysis-title">Kiến thức cần có</h5>
          <p class="analysis-content">${locationData.analysis.requirements}</p>
      </div>
  </div>

  <div style="margin-top: 15px; text-align: center; display: flex; gap: 10px; justify-content: center;">
      <button id="show-business-analysis_1" class="analyze-business-btn">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6">
  <path d="M12 .75a8.25 8.25 0 0 0-4.135 15.39c.686.398 1.115 1.008 1.134 1.623a.75.75 0 0 0 .577.706c.352.083.71.148 1.074.195.323.041.6-.218.6-.544v-4.661a6.714 6.714 0 0 1-.937-.171.75.75 0 1 1 .374-1.453 5.261 5.261 0 0 0 2.626 0 .75.75 0 1 1 .374 1.452 6.712 6.712 0 0 1-.937.172v4.66c0 .327.277.586.6.545.364-.047.722-.112 1.074-.195a.75.75 0 0 0 .577-.706c.02-.615.448-1.225 1.134-1.623A8.25 8.25 0 0 0 12 .75Z" />
  <path fill-rule="evenodd" d="M9.013 19.9a.75.75 0 0 1 .877-.597 11.319 11.319 0 0 0 4.22 0 .75.75 0 1 1 .28 1.473 12.819 12.819 0 0 1-4.78 0 .75.75 0 0 1-.597-.876ZM9.754 22.344a.75.75 0 0 1 .824-.668 13.682 13.682 0 0 0 2.844 0 .75.75 0 1 1 .156 1.492 15.156 15.156 0 0 1-3.156 0 .75.75 0 0 1-.668-.824Z" clip-rule="evenodd" />
</svg>

          Phân tích ý tưởng kinh doanh
      </button>
      ${
           hasExistingIdeas
                ? `
          <button id="show-business-history-btn_1" class="analyze-business-btn" style="background-color: #2196F3;">
              <svg width="16px" height="16px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <g clip-path="url(#clip0_429_11075)"> <path d="M5.63606 18.3639C9.15077 21.8786 14.8493 21.8786 18.364 18.3639C21.8787 14.8492 21.8787 9.1507 18.364 5.63598C14.8493 2.12126 9.15077 2.12126 5.63606 5.63598C3.87757 7.39447 2.99889 9.6996 3.00002 12.0044L3 13.9999" stroke="#292929" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path> <path d="M1 11.9999L3 13.9999L5 11.9999" stroke="#292929" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path> <path d="M11 7.99994L11 12.9999L16 12.9999" stroke="#292929" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path> </g> <defs> <clipPath id="clip0_429_11075"> <rect width="24" height="24" fill="white"></rect> </clipPath> </defs> </g></svg>
              Xem lịch sử ý tưởng
          </button>
      `
                : ''
      }
  </div>
</div>
`;

          // Sau khi nội dung được render, gán sự kiện
          setTimeout(() => {
               const analyzeBusinessBtn = document.getElementById('show-business-analysis_1') as HTMLButtonElement;
               if (analyzeBusinessBtn) {
                    analyzeBusinessBtn.addEventListener('click', () => handleSearchBusinessAnalysis());
               }

               const showBusinessHistoryBtn = document.getElementById(
                    'show-business-history-btn_1',
               ) as HTMLButtonElement;
               if (showBusinessHistoryBtn) {
                    showBusinessHistoryBtn.addEventListener('click', () => {
                         console.log('005');
                         showBusinessHistory(locationData.lat, locationData.lng);
                    });
               }
          }, 0);
          return popupContent;
     }

     function setTempLocationData(data: any) {
          if (!data || !data.lat || !data.lng) {
               console.error('Invalid location data:', data);
               return false;
          }
          window.tempLocationData = {
               name: data.name || '',
               lat: data.lat,
               lng: data.lng,
               type: data.type || '',
               sectors: Array.isArray(data.sectors) ? data.sectors : [],
               analysis: {
                    strengths: data.analysis?.strengths || '',
                    weaknesses: data.analysis?.weaknesses || '',
                    challenges: data.analysis?.challenges || '',
                    requirements: data.analysis?.requirements || '',
               },
          };
          return true;
     }

     function handleSearchBusinessAnalysis() {
          const locationData = window.tempLocationData;
          if (!locationData || !locationData.lat || !locationData.lng) {
               alert('Không tìm thấy thông tin địa điểm. Vui lòng thử lại.');
               return;
          }
          showSearchBusinessAnalysis(locationData);
     }

     function updateMapView(locationData: any) {
          const zoomLevel = locationData.type === 'địa danh' ? 15 : locationData.type === 'thành phố' ? 12 : 10;
          map.setView([locationData.lat, locationData.lng], zoomLevel);
     }

     async function analyzeDistrict(
          districtName: string,
          provinceName: string,
          coordinates: { lat: number; lng: number },
     ) {
          const prompt = `Phân tích quận/huyện ${districtName} thuộc ${provinceName} tại vị trí (${coordinates.lat}, ${coordinates.lng}).
Chỉ trả về theo định dạng JSON sau, không thêm text nào khác:
{
"basicInfo": {
  "populationDensity": "Mật độ dân số (người/km2)",
  "averageIncome": "Thu nhập bình quân/tháng (triệu đồng)"
},
"developmentTrends": [
  "Xu hướng phát triển 1",
  "Xu hướng phát triển 2",
  "Xu hướng phát triển 3"
],
"opportunities": [
  "Cơ hội phát triển 1",
  "Cơ hội phát triển 2", 
  "Cơ hội phát triển 3"
],
"challenges": [
  "Thách thức chính 1",
  "Thách thức chính 2",
  "Thách thức chính 3"
]
}
Lưu ý: Tôi là 1 người startup và hãy cho tôi những thông tin thực tế và chuẩn xác nhất có thể    
`;

          try {
               const response = await fetch(`${config.GEMINI_API_URL}?key=${config.GEMINI_API_KEY}`, {
                    method: 'POST',
                    headers: {
                         'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                         contents: [
                              {
                                   parts: [
                                        {
                                             text: prompt,
                                        },
                                   ],
                              },
                         ],
                         generationConfig: {
                              temperature: 0.7,
                              topK: 40,
                              topP: 0.95,
                              maxOutputTokens: 1024,
                         },
                    }),
               });

               const data = await response.json();
               let jsonText = data.candidates[0].content.parts[0].text;
               jsonText = cleanJsonText(jsonText);
               return JSON.parse(jsonText);
          } catch (error) {
               console.error('District analysis error:', error);
               throw new Error('Không thể phân tích quận/huyện');
          }
     }

     async function showDistrictAnalysis(districtName: string, provinceName: string, lat: number, lng: number) {
          try {
               // Hiển thị loading popup
               const loadingPopup = L.popup()
                    .setLatLng([lat, lng])
                    .setContent('<div style="text-align: center; padding: 20px;">Đang phân tích khu vực...</div>')
                    .openOn(map);

               const prompt = `Với vai trò là một chuyên gia phân tích dữ liệu và quy hoạch đô thị tại Việt Nam, hãy phân tích chi tiết về ${districtName} thuộc ${provinceName}.

Yêu cầu phân tích:
1. Dựa trên vị trí địa lý (${lat}, ${lng}), đặc điểm của khu vực và các số liệu thống kê gần nhất
2. Phân tích phải CHÍNH XÁC, PHÙ HỢP với đặc thù của quận/huyện này
3. Không đưa ra thông tin chung chung hoặc sao chép từ các khu vực khác
4. Tất cả dữ liệu phải dựa trên thực tế và xu hướng hiện tại của khu vực

Chỉ trả về theo định dạng JSON (không giải thích thêm) sau:
{
"basicInfo": {
"populationDensity": "Ước tính mật độ dân số thực tế (người/km2), dựa trên số liệu thống kê gần nhất",
"averageIncome": "Ước tính thu nhập bình quân thực tế/tháng (triệu đồng), dựa trên mặt bằng kinh tế của khu vực"
},
"developmentTrends": [
"Xu hướng phát triển quan trọng nhất hiện nay của khu vực (ví dụ: phát triển công nghiệp, đô thị hóa, du lịch...)",
"Xu hướng phát triển thứ hai đang diễn ra tại khu vực",
"Xu hướng phát triển thứ ba đang diễn ra tại khu vực"
],
"opportunities": [
"Cơ hội phát triển cụ thể và khả thi nhất cho khu vực",
"Cơ hội phát triển thứ hai dựa trên lợi thế của khu vực", 
"Cơ hội phát triển thứ ba dựa trên tiềm năng của khu vực"
],
"challenges": [
"Thách thức lớn nhất đang đối mặt (ví dụ: cơ sở hạ tầng, môi trường, việc làm...)",
"Thách thức thứ hai cần giải quyết",
"Thách thức thứ ba cần khắc phục"
]
}

Lưu ý:
- Mật độ dân số và thu nhập phải phản ánh đúng thực tế kinh tế-xã hội của khu vực
- Các xu hướng phát triển phải dựa trên các dự án và quy hoạch đang triển khai
- Cơ hội phải xuất phát từ lợi thế thực tế của khu vực
- Thách thức phải là những vấn đề thực sự khu vực đang phải đối mặt
- Chỉ trả về định dạng JSON `;

               const response = await fetch(`${config.GEMINI_API_URL}?key=${config.GEMINI_API_KEY}`, {
                    method: 'POST',
                    headers: {
                         'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                         contents: [
                              {
                                   parts: [
                                        {
                                             text: prompt,
                                        },
                                   ],
                              },
                         ],
                         generationConfig: {
                              temperature: 0.2,
                              topK: 1,
                              topP: 0.1,
                              maxOutputTokens: 1024,
                         },
                    }),
               });

               const data = await response.json();

               if (!data.candidates || !data.candidates[0]?.content?.parts[0]?.text) {
                    throw new Error('Không nhận được dữ liệu phân tích hợp lệ');
               }

               let jsonText = data.candidates[0].content.parts[0].text;
               jsonText = cleanJsonText(jsonText);
               const analysis = JSON.parse(jsonText);

               const analysisContent = `
  <div class="district-analysis-popup" style="
      max-height: 70vh;
      overflow-y: auto;
      padding-right: 10px;
      scrollbar-width: thin;
      scrollbar-color: #90CAF9 #f0f0f0;
  ">
      <div class="analysis-header" style="
          position: sticky;
          top: 0;
          background: white;
          padding: 10px 0;
          margin-bottom: 15px;
          z-index: 1000;
          border-bottom: 2px solid #f0f0f0;
      ">
          <h3 class="analysis-title" style="
              color: #2196F3;
              margin: 0;
              font-size: 18px;
              font-weight: bold;
          ">
              Phân tích: ${districtName}
          </h3>
      </div>
      
      <div class="analysis-content" style="padding-bottom: 15px;">
          <div class="info-section" style="
              background: linear-gradient(135deg, #f6f9fc 0%, #f3f4f6 100%);
              padding: 15px;
              border-radius: 8px;
              margin-bottom: 15px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.05);
              transition: transform 0.2s ease;
          ">
              <div class="info-item" style="margin-bottom: 8px;">
                  <strong style="color: #333;">Mật độ dân số:</strong> 
                  <span style="color: #666;">${analysis.basicInfo.populationDensity}</span>
              </div>
              <div class="info-item">
                  <strong style="color: #333;">Thu nhập bình quân:</strong>
                  <span style="color: #666;">${analysis.basicInfo.averageIncome}</span>
              </div>
          </div>

          <div class="analysis-section" style="
              background: linear-gradient(135deg, #f6f9fc 0%, #f3f4f6 100%);
              padding: 15px;
              border-radius: 8px;
              margin-bottom: 15px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.05);
              transition: transform 0.2s ease;
          ">
              <h4 style="
                  color: #2196F3;
                  margin-bottom: 10px;
                  font-size: 16px;
                  font-weight: 500;
              ">Xu hướng phát triển</h4>
              <ul style="
                  list-style-type: disc;
                  margin-left: 20px;
                  color: #666;
              ">
                  ${analysis.developmentTrends
                       .map(
                            (trend: string) =>
                                 `<li style="
                          margin-bottom: 8px;
                          padding: 5px;
                          transition: background-color 0.2s ease;
                      ">${trend}</li>`,
                       )
                       .join('')}
              </ul>
          </div>

          <div class="analysis-section" style="
              background: linear-gradient(135deg, #f6f9fc 0%, #f3f4f6 100%);
              padding: 15px;
              border-radius: 8px;
              margin-bottom: 15px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.05);
              transition: transform 0.2s ease;
          ">
              <h4 style="
                  color: #2196F3;
                  margin-bottom: 10px;
                  font-size: 16px;
                  font-weight: 500;
              ">Cơ hội phát triển</h4>
              <ul style="
                  list-style-type: disc;
                  margin-left: 20px;
                  color: #666;
              ">
                  ${analysis.opportunities
                       .map(
                            (opportunity: string) =>
                                 `<li style="
                          margin-bottom: 8px;
                          padding: 5px;
                          transition: background-color 0.2s ease;
                      ">${opportunity}</li>`,
                       )
                       .join('')}
              </ul>
          </div>

          <div class="analysis-section" style="
              background: linear-gradient(135deg, #f6f9fc 0%, #f3f4f6 100%);
              padding: 15px;
              border-radius: 8px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.05);
              transition: transform 0.2s ease;
          ">
              <h4 style="
                  color: #2196F3;
                  margin-bottom: 10px;
                  font-size: 16px;
                  font-weight: 500;
              ">Thách thức chính</h4>
              <ul style="
                  list-style-type: disc;
                  margin-left: 20px;
                  color: #666;
              ">
                  ${analysis.challenges
                       .map(
                            (challenge: string) =>
                                 `<li style="
                          margin-bottom: 8px;
                          padding: 5px;
                          transition: background-color 0.2s ease;
                      ">${challenge}</li>`,
                       )
                       .join('')}
              </ul>
          </div>
      </div>

      <div class="analysis-footer" style="
          position: sticky;
          bottom: 0;
          background: white;
          padding: 10px 0;
          border-top: 2px solid #f0f0f0;
      ">
          <button id="backTo-district-btn" 
                  style="
                      width: 100%;
                      padding: 8px 16px;
                      background: linear-gradient(135deg, #64B5F6 0%, #F48FB1 100%);
                      border: none;
                      border-radius: 4px;
                      color: #333;
                      cursor: pointer;
                      display: flex;
                      align-items: center;
                      gap: 8px;
                      justify-content: center;
                      font-size: 14px;
                      transition: all 0.3s ease;
                  ">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6">
  <path fill-rule="evenodd" d="M11.03 3.97a.75.75 0 0 1 0 1.06l-6.22 6.22H21a.75.75 0 0 1 0 1.5H4.81l6.22 6.22a.75.75 0 1 1-1.06 1.06l-7.5-7.5a.75.75 0 0 1 0-1.06l7.5-7.5a.75.75 0 0 1 1.06 0Z" clip-rule="evenodd" />
</svg>

              Quay lại thông tin quận/huyện
          </button>
      </div>
  </div>
`;

               setTimeout(() => {
                    const backDistrictBtn = document.getElementById('backTo-district-btn') as HTMLButtonElement;
                    if (backDistrictBtn) {
                         backDistrictBtn.addEventListener('click', () =>
                              handleBackToDistrictInfo(districtName, provinceName, lat, lng),
                         );
                    }
               }, 0);

               // Thêm CSS cho scrollbar
               const style = document.createElement('style');
               style.textContent = `
  .district-analysis-popup::-webkit-scrollbar {
      width: 6px;
  }

  .district-analysis-popup::-webkit-scrollbar-track {
      background: #f0f0f0;
      border-radius: 3px;
  }

  .district-analysis-popup::-webkit-scrollbar-thumb {
      background: #90CAF9;
      border-radius: 3px;
  }

  .district-analysis-popup::-webkit-scrollbar-thumb:hover {
      background: #64B5F6;
  }

  .analysis-section:hover {
      transform: translateY(-2px);
  }

  .district-analysis-popup ul li:hover {
      background-color: rgba(144, 202, 249, 0.1);
      border-radius: 4px;
  }
`;
               document.head.appendChild(style);

               // Đóng popup loading và hiển thị kết quả
               map.closePopup(loadingPopup);
               L.popup({
                    maxWidth: 400,
                    className: 'district-analysis-popup',
               })
                    .setLatLng([lat, lng])
                    .setContent(analysisContent)
                    .openOn(map);
          } catch (error: any) {
               console.error('Analysis error:', error);
               map.closePopup();
               alert('Có lỗi xảy ra khi phân tích khu vực: ' + error.message);
          }
     }

     // Hàm xử lý quay lại thông tin quận/huyện
     function handleBackToDistrictInfo(districtName: string, provinceName: string, lat: number, lng: number) {
          const marker = L.marker([lat, lng])
               .addTo(map)
               .bindPopup(
                    `
  <div style="min-width: 200px;">
      <h3 style="color: #2196F3; margin-bottom: 8px;">${districtName}</h3>
      <p style="color: #666;">Thuộc ${provinceName}</p>
      <div style="margin-top: 8px;">
          <p>Vĩ độ: ${lat.toFixed(6)}</p>
          <p>Kinh độ: ${lng.toFixed(6)}</p>
      </div>
      <button id="show-district-btn"
              style="
                  margin-top: 10px;
                  width: 100%;
                  padding: 8px 12px;
                  background: linear-gradient(135deg, #64B5F6 0%, #F48FB1 100%);
                  border: none;
                  border-radius: 4px;
                  color: #333;
                  cursor: pointer;
                  display: flex;
                  align-items: center;
                  gap: 8px;
                  justify-content: center;
                  font-size: 14px;
                  transition: all 0.3s ease;
              ">
          <svg width="16px" height="16px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path d="M7 16H8M11.5 16H12.5M16 16H17M18.4 20H5.6C5.03995 20 4.75992 20 4.54601 19.891C4.35785 19.7951 4.20487 19.6422 4.10899 19.454C4 19.2401 4 18.9601 4 18.4V4.8C4 4.51997 4 4.37996 4.0545 4.273C4.10243 4.17892 4.17892 4.10243 4.273 4.0545C4.37996 4 4.51997 4 4.8 4H7.2C7.48003 4 7.62004 4 7.727 4.0545C7.82108 4.10243 7.89757 4.17892 7.9455 4.273C8 4.37996 8 4.51997 8 4.8V9.06863C8 9.67445 8 9.97735 8.1198 10.1176C8.22374 10.2393 8.37967 10.3039 8.53923 10.2914C8.72312 10.2769 8.93731 10.0627 9.36569 9.63431L12.6343 6.36569C13.0627 5.93731 13.2769 5.72312 13.4608 5.70865C13.6203 5.69609 13.7763 5.76068 13.8802 5.88238C14 6.02265 14 6.32556 14 6.93137V9.06863C14 9.67445 14 9.97735 14.1198 10.1176C14.2237 10.2393 14.3797 10.3039 14.5392 10.2914C14.7231 10.2769 14.9373 10.0627 15.3657 9.63431L18.6343 6.36569C19.0627 5.93731 19.2769 5.72312 19.4608 5.70865C19.6203 5.69609 19.7763 5.76068 19.8802 5.88238C20 6.02265 20 6.32556 20 6.93137V18.4C20 18.9601 20 19.2401 19.891 19.454C19.7951 19.6422 19.6422 19.7951 19.454 19.891C19.2401 20 18.9601 20 18.4 20Z" stroke="#000000" stroke-width="2" stroke-linecap="round"></path> </g></svg>
          Phân tích khu vực
      </button>
  </div>
`,
               )
               .openPopup();
          setTimeout(() => {
               const showDistrictBtn = document.getElementById('show-district-btn') as HTMLButtonElement;
               if (showDistrictBtn) {
                    showDistrictBtn.addEventListener('click', () =>
                         showDistrictAnalysis(districtName, provinceName, lat, lng),
                    );
               }
          }, 0);
          markers.set(districtName, marker);
     }

     function zoomToLocation(location: string, countryCode: string) {
          const data = countryCode === 'VN' ? provinceData : usData;

          if (!data[location]) {
               alert('Không tìm thấy dữ liệu cho địa điểm này');
               return;
          }

          const [lat, lng] = data[location].coordinates;
          map.setView([lat, lng], 11);

          if (markers.has(location)) {
               map.removeLayer(markers.get(location));
          }

          const marker = L.marker([lat, lng])
               .addTo(map)
               .bindPopup(createLocationPopup(location, data[location], countryCode))
               .openPopup();

          markers.set(location, marker);
          const backButton = document.getElementById('backToInitialView') as HTMLButtonElement;
          backButton.style.display = 'flex';
     }

     // Thêm nút phân tích và lịch sử vào cuối popup
     function createLocationPopup(locationName: string, data: any, countryCode: string) {
          const countryName = countryCode === 'VN' ? 'Việt Nam' : 'Mỹ';
          const currencyFormat =
               countryCode === 'VN' ? `${data.income} triệu đồng/tháng` : `$${data.income.toLocaleString()}/year`;
          const hasExistingIdeas = getBusinessIdeasHistory().some(
               (item: any) => item.location.lat === data.coordinates[0] && item.location.lng === data.coordinates[1],
          );
          // Add GRDP information to the popup if available
          const grdpInfo = data.grdp
               ? `
<div style="margin-bottom: 10px;">
  <p><strong>Tổng GRDP:</strong> ${data.grdp} tỉ USD</p>
</div>
`
               : '';

          const popupContent = `
<div class="analysis-popup">
  <h3 style="margin: 0 0 10px 0; color: #2196F3;">${locationName}</h3>
  <p style="margin-bottom: 10px; color: #666;">Quốc gia: ${countryName}</p>
  
  <div style="margin-bottom: 10px;">
      <p><strong>Dân số:</strong> ${data.population.toLocaleString()} người</p>
      <p><strong>Diện tích:</strong> ${data.area.toLocaleString()} km²</p>
      <p><strong>Mật độ dân số:</strong> ${data.density.toLocaleString()} người/km²</p>
      <p><strong>Thu nhập bình quân:</strong> ${currencyFormat}</p>
  </div>

  ${grdpInfo}

  ${
       data.sectors && data.sectors.length > 0
            ? `
      <div style="margin-bottom: 10px;">
          <p><strong>Các ngành chính:</strong></p>
          <ul style="list-style-type: disc; margin-left: 20px; margin-bottom: 5px;">
              ${data.sectors.map((sector: string) => `<li>${sector}</li>`).join('')}
          </ul>
      </div>
  `
            : ''
  }

  ${
       data.trends && data.trends.length > 0
            ? `
      <div style="margin-bottom: 10px;">
          <p><strong>Xu hướng phát triển:</strong></p>
          <ul style="list-style-type: disc; margin-left: 20px; margin-bottom: 5px;">
              ${data.trends.map((trend: string) => `<li>${trend}</li>`).join('')}
          </ul>
      </div>
  `
            : ''
  }

  ${
       data.opportunities
            ? `
      <div style="margin-bottom: 10px;">
          <p><strong>Cơ hội chính:</strong> ${data.opportunities}</p>
      </div>
  `
            : ''
  }

  ${
       data.challenges
            ? `
      <div style="margin-bottom: 10px;">
          <p><strong>Thách thức chính:</strong> ${data.challenges}</p>
      </div>
  `
            : ''
  }

  <div style="font-size: 12px; color: #666; margin-top: 5px; margin-bottom: 15px;">
      <p>Vĩ độ: ${data.coordinates[0]}</p>
      <p>Kinh độ: ${data.coordinates[1]}</p>
  </div>

  <div style="display: flex; gap: 10px; justify-content: center;">
      <button id="show-business-analysis" class="analyze-business-btn">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6">
  <path d="M12 .75a8.25 8.25 0 0 0-4.135 15.39c.686.398 1.115 1.008 1.134 1.623a.75.75 0 0 0 .577.706c.352.083.71.148 1.074.195.323.041.6-.218.6-.544v-4.661a6.714 6.714 0 0 1-.937-.171.75.75 0 1 1 .374-1.453 5.261 5.261 0 0 0 2.626 0 .75.75 0 1 1 .374 1.452 6.712 6.712 0 0 1-.937.172v4.66c0 .327.277.586.6.545.364-.047.722-.112 1.074-.195a.75.75 0 0 0 .577-.706c.02-.615.448-1.225 1.134-1.623A8.25 8.25 0 0 0 12 .75Z" />
  <path fill-rule="evenodd" d="M9.013 19.9a.75.75 0 0 1 .877-.597 11.319 11.319 0 0 0 4.22 0 .75.75 0 1 1 .28 1.473 12.819 12.819 0 0 1-4.78 0 .75.75 0 0 1-.597-.876ZM9.754 22.344a.75.75 0 0 1 .824-.668 13.682 13.682 0 0 0 2.844 0 .75.75 0 1 1 .156 1.492 15.156 15.156 0 0 1-3.156 0 .75.75 0 0 1-.668-.824Z" clip-rule="evenodd" />
</svg>

          Phân tích ý tưởng kinh doanh
      </button>
      ${
           hasExistingIdeas
                ? `
         <button id="show-business-history-btn" class="analyze-business-btn" style="background-color: #2196F3;">
             <svg width="16px" height="16px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <g clip-path="url(#clip0_429_11075)"> <path d="M5.63606 18.3639C9.15077 21.8786 14.8493 21.8786 18.364 18.3639C21.8787 14.8492 21.8787 9.1507 18.364 5.63598C14.8493 2.12126 9.15077 2.12126 5.63606 5.63598C3.87757 7.39447 2.99889 9.6996 3.00002 12.0044L3 13.9999" stroke="#292929" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path> <path d="M1 11.9999L3 13.9999L5 11.9999" stroke="#292929" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path> <path d="M11 7.99994L11 12.9999L16 12.9999" stroke="#292929" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path> </g> <defs> <clipPath id="clip0_429_11075"> <rect width="24" height="24" fill="white"></rect> </clipPath> </defs> </g></svg>
             Xem lịch sử ý tưởng
         </button>
     `
                : ''
      }
  </div>
</div>
`;

          // Sau khi nội dung được render, gán sự kiện
          let isListenersAssigned = false;
          const assignEventListeners = () => {
               if (isListenersAssigned) return; // Nếu đã gán, không cần gán lại
               const showAnalyzeBusinessBtn = document.getElementById('show-business-analysis') as HTMLButtonElement;
               if (showAnalyzeBusinessBtn) {
                    showAnalyzeBusinessBtn.addEventListener('click', () =>
                         showBusinessAnalysis(locationName, countryCode === 'VN'),
                    );
               }
               const showBusinessHistoryBtn = document.getElementById('show-business-history-btn') as HTMLButtonElement;
               if (showBusinessHistoryBtn) {
                    showBusinessHistoryBtn.addEventListener('click', () => {
                         console.log('004');
                         showBusinessHistory(data.coordinates[0], data.coordinates[1]);
                    });
               }
               isListenersAssigned = true; // Đánh dấu rằng listener đã được gán
          };
          // setTimeout(assignEventListeners, 0);
          map.on('popupopen', () => {
               isListenersAssigned = false; // Reset biến cờ khi popup mở
               assignEventListeners();
          });
          map.on('popupclose', () => {
               isListenersAssigned = false; // Reset biến cờ khi popup dong
          });
          return popupContent;
     }

     // History Management Functions
     function getSearchHistory() {
          const history = localStorage.getItem(config.SEARCH_HISTORY_KEY);
          return history ? JSON.parse(history) : [];
     }

     function saveSearchPoint(point: any) {
          let history = getSearchHistory();
          history = history.filter((item: any) => item.lat !== point.lat || item.lng !== point.lng);
          history.unshift(point);
          if (history.length > config.MAX_HISTORY_ITEMS) {
               history = history.slice(0, config.MAX_HISTORY_ITEMS);
          }
          localStorage.setItem(config.SEARCH_HISTORY_KEY, JSON.stringify(history));
          updateHistoryPanel();
     }

     function updateHistoryPanel() {
          const historyList = document.getElementById('history-list') as HTMLElement;
          const history = getSearchHistory();

          if (history.length == 0) {
               historyList.innerHTML = `<p style="color: #666;">Lịch sử trống</p>`;
          } else {
               historyList.innerHTML = history
                    .map(
                         (point: any, index: number) => `
      <div class="history-item">
          <div style="flex: 1; cursor: pointer;" class="history-point" data-index="${index}">
              <strong style="color: #666;">${point.name}</strong>
              <div style="font-size: 12px; color: #666;">
                  ${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}
              </div>
          </div>
          <button class="delete-history-item" data-index="${index}" title="Xóa điểm này">
             <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#666" class="size-6">
                              <path
                                   fill-rule="evenodd"
                                   d="M16.5 4.478v.227a48.816 48.816 0 0 1 3.878.512.75.75 0 1 1-.256 1.478l-.209-.035-1.005 13.07a3 3 0 0 1-2.991 2.77H8.084a3 3 0 0 1-2.991-2.77L4.087 6.66l-.209.035a.75.75 0 0 1-.256-1.478A48.567 48.567 0 0 1 7.5 4.705v-.227c0-1.564 1.213-2.9 2.816-2.951a52.662 52.662 0 0 1 3.369 0c1.603.051 2.815 1.387 2.815 2.951Zm-6.136-1.452a51.196 51.196 0 0 1 3.273 0C14.39 3.05 15 3.684 15 4.478v.113a49.488 49.488 0 0 0-6 0v-.113c0-.794.609-1.428 1.364-1.452Zm-.355 5.945a.75.75 0 1 0-1.5.058l.347 9a.75.75 0 1 0 1.499-.058l-.346-9Zm5.48.058a.75.75 0 1 0-1.498-.058l-.347 9a.75.75 0 0 0 1.5.058l.345-9Z"
                                   clip-rule="evenodd"
                              />
                         </svg>

          </button>
      </div>
  `,
                    )
                    .join('');
          }
          // Gán sự kiện sau khi các phần tử đã được tạo
          setTimeout(() => {
               document.querySelectorAll('.history-point')?.forEach((element) => {
                    element.addEventListener('click', function (this: HTMLElement) {
                         const index = this.getAttribute('data-index');
                         jumpToHistoryPoint(index);
                    });
               });
               document.querySelectorAll('.delete-history-item')?.forEach((element) => {
                    element.addEventListener('click', function (this: HTMLElement, event) {
                         event.stopPropagation(); // Ngăn chặn sự kiện click lan ra ngoài
                         const index = this.getAttribute('data-index');
                         deleteHistoryItem(index);
                    });
               });
          }, 0);
     }

     function jumpToHistoryPoint(index: any) {
          const history = getSearchHistory();
          const point = history[index];

          if (!point) return;

          if (searchMarker) {
               map.removeLayer(searchMarker);
          }

          const popupContent = createSearchResultPopup(point);
          searchMarker = L.marker([point.lat, point.lng], {
               title: point.name,
          })
               .bindPopup(popupContent as Content)
               .addTo(map);

          updateMapView(point);
          searchMarker.openPopup();

          const historyPanel = document.getElementById('history-panel') as HTMLElement;
          const toggleHistoryBtn = document.getElementById('toggleHistory') as HTMLButtonElement;
          historyPanel.classList.remove('visible');
          toggleHistoryBtn.classList.remove('active');
     }

     function validateBusinessAnalysis(data: any) {
          if (!data || !data.businessIdea) {
               throw new Error('Dữ liệu phân tích không hợp lệ');
          }

          const required = {
               businessIdea: ['name', 'description', 'businessModel', 'challenges', 'implementationSteps'],
               businessModel: ['overview', 'targetCustomer', 'valueProposition', 'revenueStreams'],
          };

          // Validate business idea fields
          for (const field of required.businessIdea) {
               if (!data.businessIdea[field]) {
                    throw new Error(`Thiếu thông tin: ${field}`);
               }
          }

          // Validate business model fields
          for (const field of required.businessModel) {
               if (!data.businessIdea.businessModel[field]) {
                    throw new Error(`Thiếu thông tin mô hình kinh doanh: ${field}`);
               }
          }

          // Ensure arrays exist and are properly formatted
          if (!Array.isArray(data.businessIdea.challenges)) {
               data.businessIdea.challenges = [];
          }

          if (!Array.isArray(data.businessIdea.implementationSteps)) {
               data.businessIdea.implementationSteps = [];
          }

          return true;
     }

     function deleteHistoryItem(index: any) {
          let history = getSearchHistory();
          const point = history[index];

          if (confirm(`Bạn có chắc muốn xóa điểm "${point.name}" khỏi lịch sử?`)) {
               if (
                    searchMarker &&
                    searchMarker.getLatLng().lat === point.lat &&
                    searchMarker.getLatLng().lng === point.lng
               ) {
                    map.removeLayer(searchMarker);
               }
               history.splice(index, 1);
               localStorage.setItem(config.SEARCH_HISTORY_KEY, JSON.stringify(history));
               updateHistoryPanel();
          }
     }

     function clearHistory() {
          if (confirm('Bạn có chắc muốn xóa tất cả lịch sử tìm kiếm?')) {
               localStorage.removeItem(config.SEARCH_HISTORY_KEY);
               if (searchMarker) {
                    map.removeLayer(searchMarker);
               }
               markers.clear();
               updateHistoryPanel();
          }
     }

     useEffect(() => {
          const loadDistrictData = async () => {
               const districtResponse = await fetch('/quan_huyen.csv');
               const districtText = await districtResponse.text();
               districtsData = organizeDistrictsByProvince(districtText);
          };
          loadDistrictData();
          initializeMap();
          initializeControls();
          initializeCountriesPanel();
          updateHistoryPanel();
          loadProvinceData();
     }, []);

     return (
          <>
               <button className="top-left-button" id="backToInitialView">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="size-6">
                         <path
                              fillRule="evenodd"
                              d="M4.755 10.059a7.5 7.5 0 0 1 12.548-3.364l1.903 1.903h-3.183a.75.75 0 1 0 0 1.5h4.992a.75.75 0 0 0 .75-.75V4.356a.75.75 0 0 0-1.5 0v3.18l-1.9-1.9A9 9 0 0 0 3.306 9.67a.75.75 0 1 0 1.45.388Zm15.408 3.352a.75.75 0 0 0-.919.53 7.5 7.5 0 0 1-12.548 3.364l-1.902-1.903h3.183a.75.75 0 0 0 0-1.5H2.984a.75.75 0 0 0-.75.75v4.992a.75.75 0 0 0 1.5 0v-3.18l1.9 1.9a9 9 0 0 0 15.059-4.035.75.75 0 0 0-.53-.918Z"
                              clipRule="evenodd"
                         />
                    </svg>
                    Quay lại vị trí ban đầu
               </button>
               <div className="control-buttons">
                    <button className="control-button" id="toggleCountries">
                         <span>
                              <svg
                                   width="25px"
                                   height="25px"
                                   viewBox="0 0 24 24"
                                   fill="none"
                                   xmlns="http://www.w3.org/2000/svg"
                              >
                                   <g id="SVGRepo_bgCarrier" strokeWidth="0"></g>
                                   <g id="SVGRepo_tracerCarrier" strokeLinecap="round" strokeLinejoin="round"></g>
                                   <g id="SVGRepo_iconCarrier">
                                        {' '}
                                        <circle cx="12" cy="12" r="10" stroke="#1C274C" strokeWidth="1.5"></circle>{' '}
                                        <path
                                             d="M6 4.71053C6.78024 5.42105 8.38755 7.36316 8.57481 9.44737C8.74984 11.3955 10.0357 12.9786 12 13C12.7549 13.0082 13.5183 12.4629 13.5164 11.708C13.5158 11.4745 13.4773 11.2358 13.417 11.0163C13.3331 10.7108 13.3257 10.3595 13.5 10C14.1099 8.74254 15.3094 8.40477 16.2599 7.72186C16.6814 7.41898 17.0659 7.09947 17.2355 6.84211C17.7037 6.13158 18.1718 4.71053 17.9377 4"
                                             stroke="#1C274C"
                                             strokeWidth="1.5"
                                        ></path>{' '}
                                        <path
                                             d="M22 13C21.6706 13.931 21.4375 16.375 17.7182 16.4138C17.7182 16.4138 14.4246 16.4138 13.4365 18.2759C12.646 19.7655 13.1071 21.3793 13.4365 22"
                                             stroke="#1C274C"
                                             strokeWidth="1.5"
                                        ></path>{' '}
                                   </g>
                              </svg>
                         </span>
                         Thông tin các nước
                    </button>
                    <button className="control-button" id="toggleHistory">
                         <span>
                              <svg
                                   viewBox="0 0 24 24"
                                   width="25px"
                                   height="25px"
                                   fill="none"
                                   xmlns="http://www.w3.org/2000/svg"
                              >
                                   <g id="SVGRepo_bgCarrier" strokeWidth="0"></g>
                                   <g id="SVGRepo_tracerCarrier" strokeLinecap="round" strokeLinejoin="round"></g>
                                   <g id="SVGRepo_iconCarrier">
                                        {' '}
                                        <path
                                             fillRule="evenodd"
                                             clipRule="evenodd"
                                             d="M5.01112 11.5747L6.29288 10.2929C6.68341 9.90236 7.31657 9.90236 7.7071 10.2929C8.09762 10.6834 8.09762 11.3166 7.7071 11.7071L4.7071 14.7071C4.51956 14.8946 4.26521 15 3.99999 15C3.73477 15 3.48042 14.8946 3.29288 14.7071L0.292884 11.7071C-0.0976406 11.3166 -0.0976406 10.6834 0.292884 10.2929C0.683408 9.90236 1.31657 9.90236 1.7071 10.2929L3.0081 11.5939C3.22117 6.25933 7.61317 2 13 2C18.5229 2 23 6.47715 23 12C23 17.5228 18.5229 22 13 22C9.85817 22 7.05429 20.5499 5.22263 18.2864C4.87522 17.8571 4.94163 17.2274 5.37096 16.88C5.80028 16.5326 6.42996 16.599 6.77737 17.0283C8.24562 18.8427 10.4873 20 13 20C17.4183 20 21 16.4183 21 12C21 7.58172 17.4183 4 13 4C8.72441 4 5.23221 7.35412 5.01112 11.5747ZM13 5C13.5523 5 14 5.44772 14 6V11.5858L16.7071 14.2929C17.0976 14.6834 17.0976 15.3166 16.7071 15.7071C16.3166 16.0976 15.6834 16.0976 15.2929 15.7071L12.2929 12.7071C12.1054 12.5196 12 12.2652 12 12V6C12 5.44772 12.4477 5 13 5Z"
                                             fill="#000000"
                                        ></path>{' '}
                                   </g>
                              </svg>
                         </span>
                         Lịch sử
                    </button>
                    <button className="control-button" id="toggleAnalysis">
                         <span>
                              <svg
                                   viewBox="0 0 24 24"
                                   width="25px"
                                   height="25px"
                                   fill="none"
                                   xmlns="http://www.w3.org/2000/svg"
                              >
                                   <g id="SVGRepo_bgCarrier" strokeWidth="0"></g>
                                   <g id="SVGRepo_tracerCarrier" strokeLinecap="round" strokeLinejoin="round"></g>
                                   <g id="SVGRepo_iconCarrier">
                                        {' '}
                                        <path
                                             d="M3 21V17M9 21V13M15 21V15M21 21V11M8.43934 5.56066C8.71079 5.83211 9.08579 6 9.5 6C9.91421 6 10.2892 5.83211 10.5607 5.56066M8.43934 5.56066C8.16789 5.28921 8 4.91421 8 4.5C8 3.67157 8.67157 3 9.5 3C10.3284 3 11 3.67157 11 4.5C11 4.91421 10.8321 5.28921 10.5607 5.56066M8.43934 5.56066L5.56066 8.43934M5.56066 8.43934C5.28921 8.16789 4.91421 8 4.5 8C3.67157 8 3 8.67157 3 9.5C3 10.3284 3.67157 11 4.5 11C5.32843 11 6 10.3284 6 9.5C6 9.08579 5.83211 8.71079 5.56066 8.43934ZM10.5607 5.56066L13.4393 8.43934M13.4393 8.43934C13.1679 8.71079 13 9.08579 13 9.5C13 10.3284 13.6716 11 14.5 11C15.3284 11 16 10.3284 16 9.5C16 9.08579 15.8321 8.71079 15.5607 8.43934M13.4393 8.43934C13.7108 8.16789 14.0858 8 14.5 8C14.9142 8 15.2892 8.16789 15.5607 8.43934M15.5607 8.43934L18.4393 5.56066M18.4393 5.56066C18.7108 5.83211 19.0858 6 19.5 6C20.3284 6 21 5.32843 21 4.5C21 3.67157 20.3284 3 19.5 3C18.6716 3 18 3.67157 18 4.5C18 4.91421 18.1679 5.28921 18.4393 5.56066Z"
                                             stroke="#000000"
                                             strokeWidth="2"
                                             strokeLinecap="round"
                                             strokeLinejoin="round"
                                        ></path>{' '}
                                   </g>
                              </svg>
                         </span>
                         Phân tích khu vực
                    </button>
               </div>
               <div id="history-panel" className="history-panel">
                    <div className="panel-header">
                         <h3>Lịch sử tìm kiếm</h3>
                         <button className="close-button" id="closeHistoryPanel">
                              <svg
                                   xmlns="http://www.w3.org/2000/svg"
                                   viewBox="0 0 24 24"
                                   fill="currentColor"
                                   className="size-6"
                              >
                                   <path
                                        fillRule="evenodd"
                                        d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25Zm-1.72 6.97a.75.75 0 1 0-1.06 1.06L10.94 12l-1.72 1.72a.75.75 0 1 0 1.06 1.06L12 13.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L13.06 12l1.72-1.72a.75.75 0 1 0-1.06-1.06L12 10.94l-1.72-1.72Z"
                                        clipRule="evenodd"
                                   />
                              </svg>
                         </button>
                    </div>
                    <div id="history-list"></div>
                    <button className="clear-history" onClick={() => clearHistory()}>
                         <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              fill="currentColor"
                              className="size-6"
                         >
                              <path
                                   fillRule="evenodd"
                                   d="M16.5 4.478v.227a48.816 48.816 0 0 1 3.878.512.75.75 0 1 1-.256 1.478l-.209-.035-1.005 13.07a3 3 0 0 1-2.991 2.77H8.084a3 3 0 0 1-2.991-2.77L4.087 6.66l-.209.035a.75.75 0 0 1-.256-1.478A48.567 48.567 0 0 1 7.5 4.705v-.227c0-1.564 1.213-2.9 2.816-2.951a52.662 52.662 0 0 1 3.369 0c1.603.051 2.815 1.387 2.815 2.951Zm-6.136-1.452a51.196 51.196 0 0 1 3.273 0C14.39 3.05 15 3.684 15 4.478v.113a49.488 49.488 0 0 0-6 0v-.113c0-.794.609-1.428 1.364-1.452Zm-.355 5.945a.75.75 0 1 0-1.5.058l.347 9a.75.75 0 1 0 1.499-.058l-.346-9Zm5.48.058a.75.75 0 1 0-1.498-.058l-.347 9a.75.75 0 0 0 1.5.058l.345-9Z"
                                   clipRule="evenodd"
                              />
                         </svg>
                         Xóa tất cả
                    </button>
               </div>
               <div id="countries-panel" className="countries-panel">
                    <div className="panel-header">
                         <button className="back-button" id="backButton">
                              <svg
                                   xmlns="http://www.w3.org/2000/svg"
                                   viewBox="0 0 24 24"
                                   fill="currentColor"
                                   className="size-6"
                              >
                                   <path
                                        fillRule="evenodd"
                                        d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25Zm-4.28 9.22a.75.75 0 0 0 0 1.06l3 3a.75.75 0 1 0 1.06-1.06l-1.72-1.72h5.69a.75.75 0 0 0 0-1.5h-5.69l1.72-1.72a.75.75 0 0 0-1.06-1.06l-3 3Z"
                                        clipRule="evenodd"
                                   />
                              </svg>
                         </button>
                         <h3 id="title-list">Danh sách các tỉnh</h3>
                         <button className="close-button" id="closeCountriesPanel">
                              <svg
                                   xmlns="http://www.w3.org/2000/svg"
                                   viewBox="0 0 24 24"
                                   fill="currentColor"
                                   className="size-6"
                              >
                                   <path
                                        fillRule="evenodd"
                                        d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25Zm-1.72 6.97a.75.75 0 1 0-1.06 1.06L10.94 12l-1.72 1.72a.75.75 0 1 0 1.06 1.06L12 13.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L13.06 12l1.72-1.72a.75.75 0 1 0-1.06-1.06L12 10.94l-1.72-1.72Z"
                                        clipRule="evenodd"
                                   />
                              </svg>
                         </button>
                    </div>
                    <div className="countries-list" id="countriesList"></div>

                    <div className="search-container search-in-countries">
                         <input
                              type="text"
                              className="search-input"
                              id="searchInput"
                              placeholder="Nhập địa điểm để tìm kiếm..."
                         />
                         <button className="search-button" onClick={() => searchLocation()}>
                              <svg
                                   xmlns="http://www.w3.org/2000/svg"
                                   fill="none"
                                   viewBox="0 0 24 24"
                                   strokeWidth="1.5"
                                   stroke="currentColor"
                                   className="size-6"
                              >
                                   <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                                   />
                              </svg>
                         </button>
                         <span id="loading" className="loading">
                              ⌛
                         </span>
                    </div>
               </div>
               <div id="map" ref={ref} className={props.className}></div>
          </>
     );
});

export default MapIndustry;
