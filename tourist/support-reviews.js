(function () {
        var reviewTargetCount = 97;
        var pagerWindowSize = 5;
        var pageSize = 10;
        var currentPage = 1;
        var list = document.getElementById("touristReviewsList");
        var count = document.getElementById("touristReviewsCount");
        var pager = document.getElementById("touristReviewsPager");
        var form = document.getElementById("touristReviewForm");
        var nameInput = document.getElementById("touristReviewName");
        var textInput = document.getElementById("touristReviewText");
        var note = document.getElementById("touristReviewNote");
        var submitBtn = form ? form.querySelector(".tourist-review-form__submit") : null;
        var publishedBox = document.getElementById("touristReviewPublished");
        var lightbox = document.getElementById("touristReviewLightbox");
        var lightboxImage = document.getElementById("touristReviewLightboxImage");
        var publishedStorageKey = "touristReviewPublished:v3";

        function buildSeedReviews(total) {
          var reviewContent = [
                    {
                              "name": "Miguel Angel Soler Lull",
                              "text": "Me contestaron incluso cuando pregunté varias veces lo mismo. Paciencia tienen."
                    },
                    {
                              "name": "PEDRO CHAVEZ PACENCIA",
                              "text": "MonetoPlus pelea bastante por el cliente, eso se nota. En mi caso el banco al principio no lo veía claro, pero ellos siguieron con la solicitud hasta que salió aprobada. La única pega es que tuve que contratar un seguro, pero después de eso el dinero llegó sin problema."
                    },
                    {
                              "name": "Alfonso Pérez Coll",
                              "text": "Me aprobaron una buena cantidad para comprar un coche nuevo. Lo hice desde casa y en dos días ya había recibido el dinero."
                    },
                    {
                              "name": "Dácil Rodríguez",
                              "text": "No es que regalen créditos, hay revisión y el banco pregunta cosas, pero te acompañan y eso ayuda mucho cuando no sabes por dónde seguir."
                    },
                    {
                              "name": "Joaquin Gil Ojea",
                              "text": "El proceso fue bastante sencillo. Rellené la solicitud, me pidieron confirmar algunos datos y luego el banco dio el visto bueno."
                    },
                    {
                              "name": "Miguel Mella",
                              "text": "La solicitud fue mucho más rápida de lo que esperaba. En mi caso fueron 5.500 € aprobados y sin tener que desplazarme."
                    },
                    {
                              "name": "Ricardo Abruñedo Pan",
                              "text": "Me aprobaron 30.000 € después de varias comprobaciones. Fue una cantidad importante para mí y agradezco que llevaran el proceso con calma."
                    },
                    {
                              "name": "Jose Covas Biedma",
                              "text": "El banco pidió seguro para cerrar la operación. No me encantó ese punto, pero estaba explicado y después de firmar recibí el dinero."
                    },
                    {
                              "name": "Baltasar Salvador",
                              "text": "Buena gestión, repetiría si lo necesitara."
                    },
                    {
                              "name": "Luis Domingo Sanfrutos Fernandez",
                              "text": "Lo que más me gustó fue no tener que ir a una oficina. Firmé los documentos online y el banco aprobó 6.500 € después de la revisión."
                    },
                    {
                              "name": "Ma Carmen Canes",
                              "text": "Hola buenas tarde encantado con vuestro equipo para recibir un credito"
                    },
                    {
                              "name": "Maria Vasquez Sánchez",
                              "text": "MonetoPlus insistió bastante con mi caso. Yo ya pensaba dejarlo, pero ellos siguieron revisando opciones con bancos colaboradores hasta que encontraron una salida. Muy agradecida."
                    },
                    {
                              "name": "Angel Matamoros ferrando",
                              "text": "Con MonetoPlus pude conseguir 6.000 € para terminar unos pagos pendientes. La gestión fue online y bastante cómoda, aunque tuve que revisar bien los documentos antes de firmar."
                    },
                    {
                              "name": "Angel Garcia Garcia",
                              "text": "Muy bien en general. Solo mejoraría que expliquen antes todos los posibles gastos, porque alguna cosa me enteré durante el proceso. Aun así, el crédito salió y cumplieron."
                    },
                    {
                              "name": "Margarita Ramos jaimes",
                              "text": "Me aprobaron una buena cantidad para cambiar el coche. Lo hice desde casa y en dos días ya tenía todo cerrado."
                    },
                    {
                              "name": "Jose Pellicer",
                              "text": "No conocía MonetoPlus y entré con bastante desconfianza, pero me explicaron el proceso paso a paso. El banco tardó un poco en revisar, aunque al final salió aprobado."
                    },
                    {
                              "name": "Aimar Etxeberria",
                              "text": "Me ayudaron a preparar la solicitud cuando mi banco no me daba respuesta clara. No fue automático, pero sí sentí que estaban pendientes hasta el final."
                    },
                    {
                              "name": "Marcos Rodas",
                              "text": "Me gustó que no tuve que desplazarme. Firmé desde el móvil y pude descargar los papeles en PDF sin complicarme."
                    },
                    {
                              "name": "sergio taboada",
                              "text": "Al principio me pidieron más información y pensé que se iba a caer todo. MonetoPlus siguió revisando con el banco y finalmente me aprobaron."
                    },
                    {
                              "name": "José A Vázquez",
                              "text": "Al final tuve que aceptar un producto adicional para que el banco cerrara la aprobación. No era mi idea inicial, pero me explicaron todo antes."
                    },
                    {
                              "name": "Svetla Kirilova Karadzhova",
                              "text": "Me aprobaron una cantidad buena para juntar varias deudas en un solo pago. No fue perfecto, pero ahora al menos tengo todo más ordenado y sé lo que pago cada mes."
                    },
                    {
                              "name": "Zohaib Ul hassan",
                              "text": "Al final de la operación me solicitaron la contratación del seguro. No era lo que esperaba, pero me explicaron el motivo con claridad y pude tomar la decisión con tranquilidad. Después de aceptarlo, el dinero llegó rápidamente a mi cuenta."
                    },
                    {
                              "name": "Gorge Petrov",
                              "text": "Me aprobaron 12.000 € cuando ya pensaba que no iba a salir. MonetoPlus movió la solicitud con el banco y me fueron avisando de cada paso. Muy buena experiencia."
                    },
                    {
                              "name": "arif rasheed",
                              "text": "Bastante mejor de lo esperado."
                    },
                    {
                              "name": "Thomas Dolan",
                              "text": "Me concedieron 22.000 € para reformar el baño y parte de la cocina. Lo más importante para mí fue no tener que pedir favores a la familia."
                    },
                    {
                              "name": "Razak Kadiri IBRAHIM",
                              "text": "MonetoPlus no solo manda la solicitud y ya está, hacen seguimiento. En mi caso eso marcó la diferencia. El banco pidió seguro para terminar de aprobar, lo hice y al poco tiempo tenía el préstamo ingresado."
                    },
                    {
                              "name": "Doris Imasuen",
                              "text": "MonetoPlus me ayudó cuando ya pensaba que ningún banco iba a aprobar mi solicitud."
                    },
                    {
                              "name": "Michael Jorge Casuga Godoy",
                              "text": "en principio no hay problema, pero porque el primer prestamo que te deja hacer es bajo. Ya veremos cuando necesite un monto más alto"
                    },
                    {
                              "name": "Mercedes Labrador Contreras",
                              "text": "Me ayudaron bastante con la documentación. Yo no soy muy de hacer estas cosas por internet, pero la firma digital fue sencilla y me llegó todo en PDF. Para mí fue cómodo y claro."
                    },
                    {
                              "name": "Ivan Tihomirov Banchev",
                              "text": "Buen trato."
                    },
                    {
                              "name": "Omarsadiik Abdi",
                              "text": "pues no me esperaba que pudiera lograrlo estoy muy agradecida porque realmente lo necesitaba para salir un poco del bache y estoy muy contenta"
                    },
                    {
                              "name": "husnain arshad",
                              "text": "gracias a ellos puedo pagar facturas lo recomiendo"
                    },
                    {
                              "name": "Prince Bulu",
                              "text": "Rápidos y claros."
                    },
                    {
                              "name": "Zahra Mrissita",
                              "text": "La atención fue bastante humana. No sentí que me contestara un robot, me explicaron qué faltaba y por qué el banco podía pedir más información. Eso se agradece."
                    },
                    {
                              "name": "Nelson Barcia Ferreiro",
                              "text": "No esperaba que saliera, pero salió."
                    },
                    {
                              "name": "Alejandro",
                              "text": "No tenía claro si la firma digital servía igual que firmar en papel, pero me lo explicaron y pude descargar todo. Para mí fue mucho más fácil que ir al banco."
                    },
                    {
                              "name": "Joan Aguilar",
                              "text": "No fue la opción más barata del mundo, pero sí la que me dio respuesta cuando la necesitaba. Para una urgencia familiar me sacó de un apuro grande."
                    },
                    {
                              "name": "francisco antonio gonzalez mesa",
                              "text": "Buen servicio, aunque deberían explicar mejor algunos costes desde el principio. Aun así, cumplieron y recibí el dinero."
                    },
                    {
                              "name": "Brian V",
                              "text": "Me llamaron para aclarar dos datos y después todo fue bastante fluido. No me vendieron humo, simplemente fueron moviendo la solicitud hasta que el banco respondió que sí."
                    },
                    {
                              "name": "Ricard Casadevall Pla",
                              "text": "La primera respuesta llegó en minutos, pero luego el banco pidió revisar algo más. MonetoPlus siguió pendiente y al final se aprobó."
                    },
                    {
                              "name": "Eric Ros",
                              "text": "Me sirvió para salir del mes."
                    },
                    {
                              "name": "Sandra Mazorra Perez",
                              "text": "Al principio me faltaba confianza porque no conocía la empresa. Después de hablar con atención al cliente me quedé más tranquila y seguí con la solicitud."
                    },
                    {
                              "name": "Gustavo Téllez Robleto",
                              "text": "Me gustó la claridad. Si faltaba algo, me lo decían directamente y no me hacían perder días esperando sin saber nada."
                    },
                    {
                              "name": "Jonathan Acosta",
                              "text": "No estaba muy convencida al principio, porque mi banco ya me había puesto varias pegas. En MonetoPlus me ayudaron a ordenar la solicitud y al final salió aprobada. Lo que más agradezco es que no tuve que ir a ninguna oficina."
                    },
                    {
                              "name": "Juan jose Romero amate",
                              "text": "A mi edad no me manejo perfecto con todo lo digital, pero el proceso fue bastante sencillo. Mi hija me ayudó con el móvil y el resto lo explicaron bien."
                    },
                    {
                              "name": "ANWARE AMACHTEH",
                              "text": "MonetoPlus me pareció útil porque no tuve que ir banco por banco. Ellos canalizaron la solicitud y yo solo fui enviando lo que pedían."
                    },
                    {
                              "name": "Amalfy Vanegas",
                              "text": "No todo fue perfecto, tardaron más de lo que esperaba, pero al menos me respondían y no me dejaron sin información. El crédito salió."
                    },
                    {
                              "name": "Sergio Pérez",
                              "text": "Buena atención, sin vueltas raras."
                    },
                    {
                              "name": "Ana Vanesa Solino",
                              "text": "Gracias, me sacaron de un apuro."
                    },
                    {
                              "name": "SEVERINO GARCIA",
                              "text": "Muy buena gestión, rápidos."
                    },
                    {
                              "name": "CrisSimmer",
                              "text": "Conseguí 11.000 € para poner al día varias cosas de casa. Lo hice todo online y me avisaron cuando faltaba un documento."
                    },
                    {
                              "name": "Beatriz Morillas Bardanca",
                              "text": "Me sacaron de un apuro familiar. Gracias."
                    },
                    {
                              "name": "Un usuario de Google",
                              "text": "No prometen milagros, pero trabajan la solicitud. En mi caso venía de dos negativas y aquí por fin encontré una opción."
                    },
                    {
                              "name": "Sergio Llinares Ortola",
                              "text": "La respuesta inicial fue rápida, luego el banco pidió una comprobación extra. Me mantuvieron informada y eso me dio bastante tranquilidad."
                    },
                    {
                              "name": "Veronica Vaccari",
                              "text": "Me aprobaron 24.000 € para reformar parte de la vivienda. Hubo varias firmas y revisiones, pero el proceso fue claro."
                    },
                    {
                              "name": "Claudio Curieses",
                              "text": "Buena atención por correo."
                    },
                    {
                              "name": "Eloy Ruiz",
                              "text": "Tenía dudas con la firma electrónica porque nunca la había usado. Me lo explicaron bien y no tuve problema para terminar el trámite."
                    },
                    {
                              "name": "Fernando Núñez Aparicio",
                              "text": "La cantidad aprobada fue mejor de lo que esperaba. No pongo perfecto porque tardó un día más, pero cumplieron."
                    },
                    {
                              "name": "Teikirisi",
                              "text": "Me ayudaron con un préstamo para comprar herramientas de trabajo. No tuve que ir de banco en banco, que era lo que más pereza me daba."
                    },
                    {
                              "name": "Diego del Amo",
                              "text": "Todo correcto, bastante sencillo."
                    },
                    {
                              "name": "Nicolás Barciela Fenández",
                              "text": "Pensaba que por mi edad iba a ser más complicado hacerlo online, pero fue más fácil de lo esperado. Me atendieron con paciencia."
                    },
                    {
                              "name": "David Sanchez Garcia",
                              "text": "Necesitaba juntar pagos pequeños y quedarme con una cuota más ordenada. MonetoPlus me orientó y el banco aceptó la propuesta."
                    },
                    {
                              "name": "David SS",
                              "text": "Aprobado y sin oficina, justo lo que necesitaba."
                    },
                    {
                              "name": "Jeny.Jairo5",
                              "text": "Me llamaron para confirmar datos y luego recibí la respuesta del banco. Me gustó que no me dejaran esperando sin saber nada."
                    },
                    {
                              "name": "Erika Rojas Principe",
                              "text": "Me aprobaron 7.800 € para arreglar el coche y pagar unas facturas. El ingreso llegó después de terminar las firmas."
                    },
                    {
                              "name": "jonatan pallares",
                              "text": "La web es simple y el trámite no se hizo pesado. Solo tuve que revisar bien las condiciones antes de aceptar."
                    },
                    {
                              "name": "Giovanni Gil Sanchez",
                              "text": "Muy atentos, la verdad."
                    },
                    {
                              "name": "Marcos Fdez.",
                              "text": "Me habían rechazado en otra entidad y aquí encontraron otra vía. No fue en cinco minutos, pero salió."
                    },
                    {
                              "name": "Jesus Gonzalez Langa",
                              "text": "Me gustó que explicaran qué parte dependía de MonetoPlus y qué parte revisaba el banco. Eso evita confusiones."
                    },
                    {
                              "name": "Arturo Vivó",
                              "text": "Conseguí 16.500 € para mi negocio. Necesitaba liquidez para compras y me llegó justo a tiempo."
                    },
                    {
                              "name": "sab ina",
                              "text": "Buena experiencia en general. Hubo que enviar una nómina actualizada, pero nada raro."
                    },
                    {
                              "name": "Erika Hernandez",
                              "text": "Me respondieron rápido incluso cuando pregunté dos veces lo mismo. Se agradece la paciencia."
                    },
                    {
                              "name": "ROBERTO VARELA CORRAL",
                              "text": "Me ayudaron cuando ya estaba cansada de rellenar formularios en otros sitios. Aquí por lo menos hubo seguimiento."
                    },
                    {
                              "name": "Lara Gallego",
                              "text": "Muy bien, recomendado."
                    },
                    {
                              "name": "Ana Jose Abellan",
                              "text": "El préstamo quedó aprobado después de revisar unos datos. Lo importante es que me fueron avisando y pude terminar todo desde casa."
                    },
                    {
                              "name": "Antonio Fernández Alabarce",
                              "text": "No era la opción más barata, pero necesitaba una solución real. Al final me sirvió para cancelar una deuda antigua."
                    },
                    {
                              "name": "Oscar Pascual",
                              "text": "Me aprobaron 5.000 € y con eso pude cubrir una urgencia médica en la familia. El trato fue correcto y bastante cercano."
                    },
                    {
                              "name": "Julio Alberto Garcia",
                              "text": "Se nota que empujan la solicitud. En otros sitios me mandaban esperar, aquí al menos iban moviendo el caso."
                    },
                    {
                              "name": "iagoVR",
                              "text": "Fácil de usar y claro."
                    },
                    {
                              "name": "Dani PS",
                              "text": "Tuve que leer bien los documentos porque había varios PDF, pero estaban disponibles antes de firmar. Eso me dio confianza."
                    },
                    {
                              "name": "JAVIER CHAMORRO HERNANDEZ",
                              "text": "Me ayudaron a conseguir financiación para terminar una obra pequeña. El banco aprobó y pude empezar la semana siguiente."
                    },
                    {
                              "name": "Iván Ulcuango Rivera",
                              "text": "No esperaba que me aprobaran por mi contrato temporal. Tardó un poco más, pero finalmente salió adelante."
                    },
                    {
                              "name": "johnatan luccitti",
                              "text": "Gracias, todo salió bien."
                    },
                    {
                              "name": "Alfons Riera Brell",
                              "text": "Me pidieron un dato adicional del banco y pensé que era mala señal. Al final solo era una comprobación y la operación siguió."
                    },
                    {
                              "name": "Rachel Martínez",
                              "text": "Lo mejor fue poder hacerlo todo sin perder una mañana en oficinas. Solicitud, firma y documentos desde el móvil."
                    },
                    {
                              "name": "emilio toledo toledo",
                              "text": "Me concedieron 28.000 € para una reforma importante. No fue inmediato, pero el acompañamiento fue serio."
                    },
                    {
                              "name": "Joaqui Paredes",
                              "text": "Atención amable y clara."
                    },
                    {
                              "name": "Rafael Bergillos Rivert",
                              "text": "MonetoPlus me ayudó a presentar mejor la solicitud. No sé si solo habría conseguido la aprobación, sinceramente."
                    },
                    {
                              "name": "YHAN BARREIROS",
                              "text": "El proceso tuvo varios pasos, pero ninguno fue complicado. Cuando el banco dio el visto bueno, el ingreso llegó sin líos."
                    },
                    {
                              "name": "V I K",
                              "text": "Me sirvió para ordenar mis cuentas. Ahora tengo una sola cuota y respiro un poco mejor."
                    },
                    {
                              "name": "marc dba",
                              "text": "Me atendieron bien desde el primer mensaje. No tuve sensación de estar hablando con una máquina."
                    },
                    {
                              "name": "Antonio Gonzalez",
                              "text": "Rápido para una urgencia."
                    },
                    {
                              "name": "Alberto Pedroche moreno",
                              "text": "Gracias por la ayuda, de verdad."
                    },
                    {
                              "name": "Angel Chico Lopez",
                              "text": "Pedí ayuda para financiar la compra de una furgoneta de trabajo. Me aprobaron una cantidad suficiente y pude seguir con mis clientes."
                    },
                    {
                              "name": "Sergio Diego Pérez García",
                              "text": "La solicitud fue más sencilla que en mi banco habitual. Me pidieron menos vueltas al principio y luego el banco revisó lo necesario."
                    },
                    {
                              "name": "Julia Martin",
                              "text": "Buena comunicación durante todo el trámite."
                    },
                    {
                              "name": "Beatriz Sánchez Núñez",
                              "text": "No fue perfecto, pero funcionó. Yo necesitaba respuesta y acompañamiento, y eso sí lo tuve hasta recibir el dinero."
                    }
          ];
          var cities = ["Valencia", "Madrid", "Sevilla", "Malaga", "Alicante", "Zaragoza", "Bilbao", "Murcia", "Granada", "Valladolid", "Cordoba", "Oviedo", "Toledo", "Pamplona", "San Sebastian", "Barcelona", "Santander", "Almeria", "Logrono", "Girona", "Tarragona", "Vigo", "Burgos", "Leon", "Cadiz", "Huelva", "Badajoz", "Salamanca", "Getafe", "Lleida"];
          var imagesByIndex = {
            0: "./rewscreen/review.png",
            2: "./rewscreen/review2.png",
            4: "./rewscreen/review3.png",
            7: "./rewscreen/review4.png",
            10: "./rewscreen/review5.png",
            13: "./rewscreen/review6.png"
          };
          var reviews = [];
          var limit = Math.min(total, reviewContent.length);

          function getReviewStatus(index) {
            var page = Math.floor(index / pageSize) + 1;
            if (page <= 3) return "Recientemente";
            if (page <= 5) return "Esta semana";
            if (page <= 8) return "Hace más de un mes";
            return "Hace más de tres meses";
          }

          for (var i = 0; i < limit; i += 1) {
            var review = {
              name: reviewContent[i].name,
              city: cities[i % cities.length],
              status: getReviewStatus(i),
              text: reviewContent[i].text
            };

            if (imagesByIndex[i]) {
              review.image = imagesByIndex[i];
            }

            reviews.push(review);
          }

          return reviews;
        }

        var reviews = buildSeedReviews(reviewTargetCount);


        function getPublishedReview() {
          try {
            return JSON.parse(localStorage.getItem(publishedStorageKey) || "null");
          } catch (err) {
            return null;
          }
        }

        function hasPublishedReview() {
          return !!getPublishedReview();
        }

        function savePublishedReview(review) {
          try {
            localStorage.setItem(publishedStorageKey, JSON.stringify(review));
          } catch (err) {}
        }

        try {
          var storedReview = getPublishedReview();
          if (storedReview && storedReview.name && storedReview.text) {
            reviews.unshift(storedReview);
          }
        } catch (err) {}

        function escapeHtml(value) {
          return String(value).replace(/[&<>"']/g, function (char) {
            return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char];
          });
        }

        function scrollToReviewCompose() {
          var compose = document.querySelector(".tourist-review-compose");
          if (compose) {
            compose.scrollIntoView({ block: "start", behavior: "smooth" });
          }
        }

        function openReviewImage(src) {
          if (!lightbox || !lightboxImage || !src) return;
          lightboxImage.src = src;
          lightbox.hidden = false;
          document.body.classList.add("tourist-review-lightbox-open");
        }

        function closeReviewImage() {
          if (!lightbox || !lightboxImage) return;
          lightbox.hidden = true;
          lightboxImage.src = "";
          document.body.classList.remove("tourist-review-lightbox-open");
        }

        function createPagerButton(label, page, className) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = className;
          btn.setAttribute("data-review-page", String(page));
          btn.textContent = label;
          return btn;
        }

        function renderReviews() {
          if (!list) return;
          var start = (currentPage - 1) * pageSize;
          var pageItems = reviews.slice(start, start + pageSize);
          var savedReview = getPublishedReview();
          list.innerHTML = pageItems.map(function (review, idx) {
            var isMine = savedReview && start === 0 && idx === 0
              && review.name === savedReview.name && review.text === savedReview.text;
            var photo = review.image
              ? '<button type="button" class="tourist-review-card__media" data-review-image="' + escapeHtml(review.image) + '" aria-label="Ver imagen de la opinion"><img class="tourist-review-card__photo" src="' + escapeHtml(review.image) + '" alt=""><span class="tourist-review-card__zoom" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8.25 13.5C11.1495 13.5 13.5 11.1495 13.5 8.25C13.5 5.35051 11.1495 3 8.25 3C5.35051 3 3 5.35051 3 8.25C3 11.1495 5.35051 13.5 8.25 13.5Z" stroke="currentColor" stroke-width="1.4"/><path d="M12.2 12.2L15 15" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></span></button>'
              : "";
            return [
              '<article class="tourist-review-card' + (isMine ? ' tourist-review-card--mine' : '') + '">',
                isMine ? '<span class="tourist-review-card__mine-badge">Tu opinión</span>' : '',
                '<div class="tourist-review-card__top">',
                  '<div class="tourist-review-card__avatar" aria-hidden="true">' + escapeHtml(review.name.charAt(0)) + '</div>',
                  '<div class="tourist-review-card__person">',
                    '<h3 class="tourist-review-card__name">' + escapeHtml(review.name) + '</h3>',
                    '<p class="tourist-review-card__meta">' + escapeHtml(review.city) + ' · ' + escapeHtml(review.status || "Recientemente") + '</p>',
                  '</div>',
                '</div>',
                '<p class="tourist-review-card__text">' + escapeHtml(review.text) + '</p>',
                photo,
              '</article>'
            ].join("");
          }).join("");

          if (count) count.textContent = String(reviews.length);
          if (pager) {
            var pagesCount = Math.ceil(reviews.length / pageSize);
            var halfWindow = Math.floor(pagerWindowSize / 2);
            var groupStart = Math.max(1, currentPage - halfWindow);
            var groupEnd = Math.min(pagesCount, groupStart + pagerWindowSize - 1);
            groupStart = Math.max(1, groupEnd - pagerWindowSize + 1);
            pager.innerHTML = "";
            pager.classList.remove("is-shifting");

            for (var i = groupStart; i <= groupEnd; i += 1) {
              var btn = createPagerButton(String(i), i, "tourist-reviews__page" + (i === currentPage ? " is-active" : ""));
              if (i === currentPage) {
                btn.setAttribute("aria-current", "page");
              }
              pager.appendChild(btn);
            }
            void pager.offsetWidth;
            pager.classList.add("is-shifting");
          }
        }

        if (pager) {
          pager.addEventListener("click", function (event) {
            var btn = event.target.closest("[data-review-page]");
            if (!btn) return;
            currentPage = parseInt(btn.getAttribute("data-review-page"), 10) || 1;
            renderReviews();
            scrollToReviewCompose();
          });
        }

        if (list) {
          list.addEventListener("click", function (event) {
            var media = event.target.closest("[data-review-image]");
            if (!media) return;
            openReviewImage(media.getAttribute("data-review-image"));
          });
        }

        if (lightbox) {
          lightbox.addEventListener("click", function (event) {
            if (event.target.closest("[data-review-lightbox-close]")) {
              closeReviewImage();
            }
          });
        }

        document.addEventListener("keydown", function (event) {
          if (event.key === "Escape" && lightbox && !lightbox.hidden) {
            closeReviewImage();
          }
        });

        function lockReviewForm(message, savedReview) {
          if (!form) return;
          form.classList.add("is-locked");
          form.hidden = true;
          if (publishedBox) {
            publishedBox.hidden = false;
            if (savedReview && savedReview.name && savedReview.text) {
              var nameEl = publishedBox.querySelector(".tourist-review-published__name");
              var previewEl = publishedBox.querySelector(".tourist-review-published__preview");
              if (nameEl) nameEl.textContent = savedReview.name;
              if (previewEl) previewEl.textContent = savedReview.text.length > 120 ? savedReview.text.substring(0, 120) + "\u2026" : savedReview.text;
            }
          }
          if (note) note.textContent = message || "Ya has publicado tu opini\u00f3n.";
        }

        if (form) {
          if (hasPublishedReview()) {
            lockReviewForm("Ya has publicado tu opini\u00f3n.", getPublishedReview());
          }

          form.addEventListener("submit", function (event) {
            event.preventDefault();
            if (hasPublishedReview()) {
              lockReviewForm("Ya has publicado tu opini\u00f3n.");
              return;
            }
            var name = nameInput.value.trim();
            var text = textInput.value.trim();
            if (!name || !text) return;
            var review = {
              name: name,
              city: "Cliente verificado",
              status: "Recientemente",
              text: text
            };
            reviews.unshift(review);
            savePublishedReview(review);
            currentPage = 1;
            form.reset();
            lockReviewForm("Gracias. Tu opini\u00f3n se ha publicado.", review);
            renderReviews();
          });
        }

        renderReviews();
      })();
